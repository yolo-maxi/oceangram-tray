import os from 'os';
import path from 'path';
import fs from 'fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMetadataStale, readInstanceMetadata, writeInstanceMetadata, removeInstanceMetadata, parseInstanceMetadata, TrayInstanceMetadata } from './instanceGuard';

test('metadata staleness uses configured threshold', () => {
  const metadata: Pick<TrayInstanceMetadata, 'schemaVersion' | 'pid' | 'startedAt' | 'appVersion' | 'commandLine'> & { lastHeartbeat: number } = {
    schemaVersion: 1,
    pid: 1,
    startedAt: 1_000,
    lastHeartbeat: 10_000,
    appVersion: '0.1.0',
    commandLine: ['node', 'app'],
  };

  assert.equal(isMetadataStale(metadata, 10_500, 1_000), false);
  assert.equal(isMetadataStale(metadata, 11_500, 1_000), true);
  assert.equal(isMetadataStale(metadata, 9_500, 1_000), false);
});

test('invalid metadata is rejected', () => {
  assert.equal(parseInstanceMetadata({ schemaVersion: 2 }), null);
  assert.equal(parseInstanceMetadata({ pid: 'foo' as unknown }), null);
});

test('metadata file round-trips through read/write', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oceangram-instance-test-'));
  const filePath = path.join(tempDir, 'instance.json');
  const metadata: TrayInstanceMetadata = {
    schemaVersion: 1,
    pid: 4321,
    startedAt: 1000,
    lastHeartbeat: 2000,
    appVersion: '0.1.0',
    commandLine: ['node', 'app'],
  };

  writeInstanceMetadata(filePath, metadata);
  assert.deepEqual(readInstanceMetadata(filePath), metadata);

  removeInstanceMetadata(filePath);
  assert.equal(readInstanceMetadata(filePath), null);
});
