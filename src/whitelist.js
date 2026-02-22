// whitelist.js — Config + whitelist management
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.oceangram-tray');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  whitelist: [],
  settings: {
    alwaysOnTop: true,
    bubblePosition: 'right',
    bubbleSize: 64,
    maxBubbles: 5,
    pollIntervalMs: 3000,
    showNotifications: true,
  },
};

class WhitelistManager {
  constructor() {
    this.config = null;
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        this.config = JSON.parse(raw);
        // Merge with defaults for any missing keys
        this.config.settings = { ...DEFAULT_CONFIG.settings, ...this.config.settings };
        if (!Array.isArray(this.config.whitelist)) {
          this.config.whitelist = [];
        }
      } else {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        this.save();
      }
    } catch (err) {
      console.error('[whitelist] Failed to load config:', err.message);
      this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      this.save();
    }
  }

  save() {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error('[whitelist] Failed to save config:', err.message);
    }
  }

  isWhitelisted(userId) {
    const id = String(userId);
    return this.config.whitelist.some((u) => String(u.userId) === id);
  }

  addUser(user) {
    const id = String(user.userId);
    if (this.isWhitelisted(id)) return false;
    this.config.whitelist.push({
      userId: id,
      username: user.username || '',
      displayName: user.displayName || user.username || id,
    });
    this.save();
    return true;
  }

  removeUser(userId) {
    const id = String(userId);
    const before = this.config.whitelist.length;
    this.config.whitelist = this.config.whitelist.filter((u) => String(u.userId) !== id);
    if (this.config.whitelist.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  getWhitelist() {
    return this.config.whitelist;
  }

  getSettings() {
    return this.config.settings;
  }

  updateSettings(partial) {
    this.config.settings = { ...this.config.settings, ...partial };
    this.save();
  }

  getUserInfo(userId) {
    const id = String(userId);
    return this.config.whitelist.find((u) => String(u.userId) === id) || null;
  }
}

module.exports = new WhitelistManager();
