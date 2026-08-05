import fs from 'fs';
import path from 'path';

export const DEFAULT_INSTANCE_STALE_MS = 45_000;
export const DEFAULT_INSTANCE_HEARTBEAT_MS = 5_000;

export interface TrayInstanceMetadata {
  readonly schemaVersion: 1;
  pid: number;
  startedAt: number;
  lastHeartbeat: number;
  appVersion: string;
  commandLine: string[];
}

export type InstanceRecoveryAction =
  | 'none'
  | 'reused-active'
  | 'cleaned-dead'
  | 'killed-stale'
  | 'failed-to-terminate-stale';

export interface InstanceRecoveryResult {
  action: InstanceRecoveryAction;
  previous: TrayInstanceMetadata | null;
}

export interface InstanceGuardOptions {
  metadataPath: string;
  staleAfterMs?: number;
  heartbeatMs?: number;
  appVersion?: string;
  now?: () => number;
}

function isValidMetadata(value: unknown): value is TrayInstanceMetadata {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  return (
    candidate.schemaVersion === 1 &&
    Number.isFinite(candidate.pid) &&
    Number.isFinite(candidate.startedAt) &&
    Number.isFinite(candidate.lastHeartbeat) &&
    typeof candidate.appVersion === 'string' &&
    Array.isArray(candidate.commandLine) &&
    candidate.commandLine.every((arg) => typeof arg === 'string')
  );
}

export function isMetadataStale(metadata: TrayInstanceMetadata, now: number, staleAfterMs: number): boolean {
  if (!Number.isFinite(metadata.lastHeartbeat)) return true;
  if (metadata.lastHeartbeat > now) return false;
  return now - metadata.lastHeartbeat > staleAfterMs;
}

export function parseInstanceMetadata(raw: unknown): TrayInstanceMetadata | null {
  if (!isValidMetadata(raw)) return null;
  return raw;
}

export function readInstanceMetadata(metadataPath: string): TrayInstanceMetadata | null {
  try {
    if (!fs.existsSync(metadataPath)) return null;
    const raw = fs.readFileSync(metadataPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return parseInstanceMetadata(parsed);
  } catch {
    return null;
  }
}

export function writeInstanceMetadata(metadataPath: string, metadata: TrayInstanceMetadata): void {
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export function removeInstanceMetadata(metadataPath: string): void {
  try {
    if (fs.existsSync(metadataPath)) {
      fs.rmSync(metadataPath);
    }
  } catch {
    // best effort cleanup
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminatePid(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await wait(200);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore, process may already be gone
  }

  await wait(100);
  return !isProcessAlive(pid);
}

export class SingleInstanceGuard {
  private metadataPath: string;
  private staleAfterMs: number;
  private heartbeatMs: number;
  private appVersion: string;
  private now: () => number;
  private timer: ReturnType<typeof setInterval> | null;
  private metadata: TrayInstanceMetadata | null;

  constructor(options: InstanceGuardOptions) {
    this.metadataPath = options.metadataPath;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_INSTANCE_STALE_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_INSTANCE_HEARTBEAT_MS;
    this.appVersion = options.appVersion ?? 'unknown';
    this.now = options.now ?? (() => Date.now());
    this.timer = null;
    this.metadata = null;
  }

  async recoverExistingInstance(): Promise<InstanceRecoveryResult> {
    const metadata = readInstanceMetadata(this.metadataPath);
    if (!metadata) {
      return { action: 'none', previous: null };
    }

    const alive = isProcessAlive(metadata.pid);
    const stale = isMetadataStale(metadata, this.now(), this.staleAfterMs);

    if (alive && !stale) {
      return { action: 'reused-active', previous: metadata };
    }

    if (!alive) {
      removeInstanceMetadata(this.metadataPath);
      return { action: 'cleaned-dead', previous: metadata };
    }

    const terminated = await terminatePid(metadata.pid);
    if (terminated) {
      removeInstanceMetadata(this.metadataPath);
      return { action: 'killed-stale', previous: metadata };
    }

    return { action: 'failed-to-terminate-stale', previous: metadata };
  }

  registerCurrentInstance(): void {
    const now = this.now();
    this.metadata = {
      schemaVersion: 1,
      pid: process.pid,
      startedAt: now,
      lastHeartbeat: now,
      appVersion: this.appVersion,
      commandLine: process.argv,
    };

    this.persist();
    this.startHeartbeat();
  }

  private persist(): void {
    if (!this.metadata) return;
    writeInstanceMetadata(this.metadataPath, this.metadata);
  }

  private startHeartbeat(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      if (!this.metadata) return;
      this.metadata.lastHeartbeat = this.now();
      this.persist();
    }, this.heartbeatMs);
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const current = readInstanceMetadata(this.metadataPath);
    if (current && current.pid === process.pid) {
      removeInstanceMetadata(this.metadataPath);
    }

    this.metadata = null;
  }
}
