// daemon.js — HTTP/WS client for oceangram-daemon at localhost:7777
const { EventEmitter } = require('events');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE_URL = 'http://localhost:7777';
const WS_URL = 'ws://localhost:7777/events';
const AVATAR_DIR = path.join(os.homedir(), '.oceangram-tray', 'avatars');

class DaemonClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.reconnectTimer = null;
    this.healthCheckTimer = null;

    // Ensure avatar cache dir
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
  }

  // ── HTTP helpers ──

  _request(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, BASE_URL);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const ct = res.headers['content-type'] || '';
          if (ct.includes('application/json')) {
            try {
              resolve(JSON.parse(raw.toString()));
            } catch {
              resolve(raw.toString());
            }
          } else {
            resolve(raw);
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async getHealth() {
    try {
      const res = await this._request('GET', '/health');
      this.connected = true;
      this.emit('connection-changed', true);
      return res;
    } catch {
      this.connected = false;
      this.emit('connection-changed', false);
      return null;
    }
  }

  async getMe() {
    try {
      return await this._request('GET', '/me');
    } catch {
      return null;
    }
  }

  async getDialogs() {
    try {
      return await this._request('GET', '/dialogs');
    } catch {
      return [];
    }
  }

  async getMessages(dialogId, limit = 30) {
    try {
      return await this._request('GET', `/dialogs/${dialogId}/messages?limit=${limit}`);
    } catch {
      return [];
    }
  }

  async sendMessage(dialogId, text) {
    try {
      return await this._request('POST', `/dialogs/${dialogId}/messages`, { text });
    } catch {
      return null;
    }
  }

  async markRead(messageId) {
    try {
      return await this._request('POST', `/messages/${messageId}/read`);
    } catch {
      return null;
    }
  }

  async getProfilePhoto(userId) {
    const cachePath = path.join(AVATAR_DIR, `${userId}.jpg`);
    // Return cached if fresh (< 24h)
    try {
      const stat = fs.statSync(cachePath);
      if (Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000) {
        return cachePath;
      }
    } catch { /* not cached */ }

    try {
      const data = await this._request('GET', `/profile/${userId}/photo`);
      if (Buffer.isBuffer(data) && data.length > 100) {
        fs.writeFileSync(cachePath, data);
        return cachePath;
      }
    } catch { /* ignore */ }
    return null;
  }

  async getProfilePhotoBase64(userId) {
    const filePath = await this.getProfilePhoto(userId);
    if (!filePath) return null;
    try {
      const data = fs.readFileSync(filePath);
      return `data:image/jpeg;base64,${data.toString('base64')}`;
    } catch {
      return null;
    }
  }

  // ── WebSocket ──

  connectWS() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }

    try {
      // Use dynamic import-like require for ws — Electron ships with it via net
      const WebSocket = require('ws');
      this.ws = new WebSocket(WS_URL);
    } catch {
      // Fallback: try native WebSocket (Electron 28+)
      try {
        this.ws = new WebSocket(WS_URL);
      } catch {
        console.log('[daemon] WebSocket not available, polling only');
        this._scheduleReconnect();
        return;
      }
    }

    this.ws.on('open', () => {
      console.log('[daemon] WS connected');
      this.reconnectAttempts = 0;
      this.connected = true;
      this.emit('connection-changed', true);
      this.emit('ws-connected');
    });

    this.ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        this.emit('event', event);
        if (event.type) {
          this.emit(event.type, event);
        }
      } catch (e) {
        console.error('[daemon] WS parse error:', e.message);
      }
    });

    this.ws.on('close', () => {
      console.log('[daemon] WS disconnected');
      this.connected = false;
      this.emit('connection-changed', false);
      this.emit('ws-disconnected');
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[daemon] WS error:', err.message);
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;
    console.log(`[daemon] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connectWS(), delay);
  }

  // ── Health check loop ──

  startHealthCheck(intervalMs = 10000) {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => this.getHealth(), intervalMs);
    this.getHealth();
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ── Lifecycle ──

  start() {
    this.startHealthCheck();
    this.connectWS();
  }

  stop() {
    this.stopHealthCheck();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }
  }
}

module.exports = new DaemonClient();
