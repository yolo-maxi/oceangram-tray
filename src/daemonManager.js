// daemonManager.js — Spawns and manages the oceangram-daemon child process
const { fork } = require('child_process');
const path = require('path');
const http = require('http');

class DaemonManager {
  constructor() {
    this.process = null;
    this.port = 7777;
  }

  // Check if daemon is already running
  async isRunning() {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${this.port}/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  }

  // Get the daemon bundle path (works in dev and packaged)
  getBundlePath() {
    if (process.resourcesPath && !process.resourcesPath.includes('node_modules')) {
      // Packaged app
      return path.join(process.resourcesPath, 'daemon-bundle.js');
    }
    // Dev mode
    return path.join(__dirname, '..', 'resources', 'daemon-bundle.js');
  }

  // Start daemon as child process
  async start() {
    if (await this.isRunning()) {
      console.log('[DaemonManager] Daemon already running on port', this.port);
      return true;
    }

    const bundlePath = this.getBundlePath();
    console.log('[DaemonManager] Starting daemon from:', bundlePath);

    this.process = fork(bundlePath, [], {
      env: { ...process.env, PORT: String(this.port) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      detached: false,
    });

    this.process.stdout?.on('data', (d) => console.log('[Daemon]', d.toString().trim()));
    this.process.stderr?.on('data', (d) => console.error('[Daemon ERR]', d.toString().trim()));
    this.process.on('exit', (code) => {
      console.log('[DaemonManager] Daemon exited with code', code);
      this.process = null;
    });

    // Wait for health check
    return this.waitForReady(15000);
  }

  async waitForReady(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isRunning()) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    console.error('[DaemonManager] Daemon failed to start within', timeoutMs, 'ms');
    return false;
  }

  stop() {
    if (this.process) {
      console.log('[DaemonManager] Stopping daemon process');
      this.process.kill('SIGTERM');
      // Force kill after 3 seconds if it doesn't exit gracefully
      const proc = this.process;
      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 3000);
      this.process = null;
    }
  }
}

module.exports = { DaemonManager };
