// tracker.js — Message tracking + filtering for whitelisted users
const { EventEmitter } = require('events');
const daemon = require('./daemon');
const whitelist = require('./whitelist');

class MessageTracker extends EventEmitter {
  constructor() {
    super();
    this.unreads = new Map(); // userId -> { dialogId, messages: [], count }
    this.lastSeenIds = new Map(); // dialogId -> lastMessageId
    this.pollTimer = null;
    this.wsActive = false;

    this._loadLastSeen();
  }

  _loadLastSeen() {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const file = path.join(os.homedir(), '.oceangram-tray', 'last-seen.json');
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          this.lastSeenIds.set(k, v);
        }
      }
    } catch { /* ignore */ }
  }

  _saveLastSeen() {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const file = path.join(os.homedir(), '.oceangram-tray', 'last-seen.json');
      const obj = Object.fromEntries(this.lastSeenIds);
      fs.writeFileSync(file, JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  start() {
    // Listen for WS events
    daemon.on('newMessage', (event) => this._handleNewMessage(event));
    daemon.on('ws-connected', () => {
      this.wsActive = true;
      console.log('[tracker] WS active, reducing poll frequency');
    });
    daemon.on('ws-disconnected', () => {
      this.wsActive = false;
      console.log('[tracker] WS lost, polling mode');
    });

    // Start polling
    const interval = whitelist.getSettings().pollIntervalMs || 3000;
    this.pollTimer = setInterval(() => this._poll(), interval);
    // Initial poll
    setTimeout(() => this._poll(), 1000);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this._saveLastSeen();
  }

  async _poll() {
    // If WS is active, poll less frequently (just for catch-up)
    if (!daemon.connected) return;

    try {
      const dialogs = await daemon.getDialogs();
      if (!Array.isArray(dialogs)) return;

      for (const dialog of dialogs) {
        const userId = String(dialog.userId || dialog.id);
        if (!whitelist.isWhitelisted(userId)) continue;

        const dialogId = String(dialog.id);
        const messages = await daemon.getMessages(dialogId, 10);
        if (!Array.isArray(messages) || messages.length === 0) continue;

        const lastSeen = this.lastSeenIds.get(dialogId);
        const newMsgs = lastSeen
          ? messages.filter((m) => m.id > lastSeen && String(m.fromId || m.senderId) === userId)
          : [];

        if (newMsgs.length > 0) {
          for (const msg of newMsgs) {
            this._addUnread(userId, dialogId, msg);
          }
        }
      }
    } catch (err) {
      console.error('[tracker] Poll error:', err.message);
    }
  }

  _handleNewMessage(event) {
    const msg = event.message || event;
    const fromId = String(msg.fromId || msg.senderId || '');
    const dialogId = String(msg.dialogId || msg.chatId || '');

    if (!fromId || !whitelist.isWhitelisted(fromId)) return;

    this._addUnread(fromId, dialogId, msg);
  }

  _addUnread(userId, dialogId, msg) {
    if (!this.unreads.has(userId)) {
      this.unreads.set(userId, { dialogId, messages: [], count: 0 });
    }

    const entry = this.unreads.get(userId);
    // Prevent duplicates
    if (entry.messages.some((m) => m.id === msg.id)) return;

    entry.dialogId = dialogId;
    entry.messages.push(msg);
    entry.count = entry.messages.length;

    this.emit('new-message', { userId, dialogId, message: msg });
    this.emit('user-unreads-changed', { userId, count: entry.count });
  }

  markRead(userId) {
    const entry = this.unreads.get(userId);
    if (!entry) return;

    // Update last seen to the latest message
    const latest = entry.messages[entry.messages.length - 1];
    if (latest) {
      this.lastSeenIds.set(entry.dialogId, latest.id);
      this._saveLastSeen();
      // Mark read on daemon
      daemon.markRead(latest.id).catch(() => {});
    }

    this.unreads.delete(userId);
    this.emit('messages-read', { userId });
    this.emit('user-unreads-changed', { userId, count: 0 });
  }

  getUnreads(userId) {
    return this.unreads.get(userId) || { dialogId: null, messages: [], count: 0 };
  }

  getAllUnreads() {
    const result = {};
    for (const [userId, data] of this.unreads) {
      result[userId] = data;
    }
    return result;
  }

  getTotalUnreadCount() {
    let total = 0;
    for (const [, data] of this.unreads) {
      total += data.count;
    }
    return total;
  }
}

module.exports = new MessageTracker();
