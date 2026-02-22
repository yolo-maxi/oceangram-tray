// main.js — Electron main process for Oceangram Tray
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, screen } = require('electron');
const path = require('path');

// Modules (loaded after app ready)
let daemon, whitelist, tracker, bubbles;

// Globals
let tray = null;
let settingsWindow = null;
let chatPopups = new Map(); // userId -> BrowserWindow

// ── App setup ──

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // Focus settings if open
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
  }
});

// Hide dock icon on macOS
if (process.platform === 'darwin') {
  app.dock.hide();
}

// ── App ready ──

app.whenReady().then(() => {
  // Load modules
  daemon = require('./daemon');
  whitelist = require('./whitelist');
  tracker = require('./tracker');
  bubbles = require('./bubbles');

  // Setup
  createTray();
  setupIPC();
  bubbles.init();
  bubbles.setPopupFactory(openChatPopup);

  // Start daemon connection & message tracking
  daemon.start();
  tracker.start();

  // Update tray based on events
  daemon.on('connection-changed', (connected) => {
    updateTrayIcon();
    // Forward to all open windows
    for (const [, win] of chatPopups) {
      if (!win.isDestroyed()) {
        win.webContents.send('connection-changed', connected);
      }
    }
  });

  tracker.on('user-unreads-changed', () => {
    updateTrayIcon();
  });

  tracker.on('new-message', (data) => {
    // Forward to relevant chat popup
    const popup = chatPopups.get(data.userId);
    if (popup && !popup.isDestroyed()) {
      popup.webContents.send('new-message', data);
    }

    // Show notification if enabled
    const settings = whitelist.getSettings();
    if (settings.showNotifications) {
      showNotification(data);
    }
  });

  console.log('[main] Oceangram Tray started');
});

app.on('window-all-closed', (e) => {
  // Don't quit when windows close — we're a tray app
  e.preventDefault();
});

app.on('before-quit', () => {
  daemon.stop();
  tracker.stop();
  bubbles.destroyAll();
});

// ── Tray ──

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  // Set as template for macOS dark/light mode
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Oceangram — Connecting...');
  updateTrayMenu();
}

function updateTrayMenu() {
  const bubblesVisible = bubbles ? bubbles.visible : true;
  const menu = Menu.buildFromTemplate([
    {
      label: bubblesVisible ? 'Hide Bubbles' : 'Show Bubbles',
      click: () => {
        bubbles.toggleVisibility();
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: openSettings,
    },
    { type: 'separator' },
    {
      label: 'Quit Oceangram',
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function updateTrayIcon() {
  if (!tray) return;

  const totalUnreads = tracker ? tracker.getTotalUnreadCount() : 0;
  const connected = daemon ? daemon.connected : false;

  let iconName = 'tray-icon.png';
  let tooltip = 'Oceangram';

  if (!connected) {
    tooltip = 'Oceangram — Disconnected';
  } else if (totalUnreads > 0) {
    iconName = 'tray-unread.png';
    tooltip = `Oceangram — ${totalUnreads} unread`;
  } else {
    tooltip = 'Oceangram — Connected';
  }

  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', iconName));
  icon.setTemplateImage(true);
  tray.setImage(icon);
  tray.setToolTip(tooltip);
}

// ── Notifications ──

function showNotification(data) {
  const userInfo = whitelist.getUserInfo(data.userId);
  const name = userInfo ? userInfo.displayName : 'Unknown';
  const text = data.message.text || data.message.message || 'New message';

  const notif = new Notification({
    title: name,
    body: text.substring(0, 200),
    silent: false,
    urgency: 'normal',
  });

  notif.on('click', () => {
    openChatPopup(data.userId);
  });

  notif.show();
}

// ── Chat Popup ──

function openChatPopup(userId) {
  // If already open, focus it
  if (chatPopups.has(userId)) {
    const existing = chatPopups.get(userId);
    if (!existing.isDestroyed()) {
      existing.focus();
      return;
    }
    chatPopups.delete(userId);
  }

  const settings = whitelist.getSettings();
  const userInfo = whitelist.getUserInfo(userId);
  const unreads = tracker.getUnreads(userId);

  // Position near the bubble if possible
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.max(20, screenW - 400 - 100);
  const y = Math.max(50, Math.floor(screenH / 2) - 250);

  const popup = new BrowserWindow({
    width: 400,
    height: 500,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: settings.alwaysOnTop !== false,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    roundedCorners: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popup.loadFile(path.join(__dirname, 'popup.html'));

  popup.webContents.on('did-finish-load', () => {
    popup.webContents.send('popup-init', {
      userId,
      dialogId: unreads.dialogId || userId,
      displayName: userInfo ? userInfo.displayName : userId,
    });
    popup.webContents.send('connection-changed', daemon.connected);
  });

  // Track popup
  chatPopups.set(userId, popup);

  popup.on('closed', () => {
    chatPopups.delete(userId);
  });

  // Mark messages as read when popup opens
  tracker.markRead(userId);

  // Remove bubble when chat is open
  if (bubbles) {
    bubbles.removeBubble(userId);
  }
}

// ── Settings Window ──

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 600,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    vibrancy: 'under-window',
    roundedCorners: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ── IPC Handlers ──

function setupIPC() {
  // Messages
  ipcMain.handle('get-messages', async (_, dialogId, limit) => {
    return await daemon.getMessages(dialogId, limit || 30);
  });

  ipcMain.handle('send-message', async (_, dialogId, text) => {
    return await daemon.sendMessage(dialogId, text);
  });

  ipcMain.handle('mark-read', async (_, userId) => {
    tracker.markRead(userId);
    return true;
  });

  ipcMain.handle('get-dialog-info', async (_, dialogId) => {
    const dialogs = await daemon.getDialogs();
    if (Array.isArray(dialogs)) {
      return dialogs.find(d => String(d.id) === String(dialogId)) || null;
    }
    return null;
  });

  ipcMain.handle('get-profile-photo', async (_, userId) => {
    return await daemon.getProfilePhotoBase64(userId);
  });

  // Whitelist
  ipcMain.handle('get-whitelist', () => {
    return whitelist.getWhitelist();
  });

  ipcMain.handle('add-user', (_, user) => {
    return whitelist.addUser(user);
  });

  ipcMain.handle('remove-user', (_, userId) => {
    return whitelist.removeUser(userId);
  });

  // Settings
  ipcMain.handle('get-settings', () => {
    return whitelist.getSettings();
  });

  ipcMain.handle('update-settings', (_, settings) => {
    whitelist.updateSettings(settings);
    // Apply settings changes
    if (settings.bubblePosition !== undefined && bubbles) {
      bubbles.repositionAll();
    }
    return true;
  });

  // Dialogs
  ipcMain.handle('get-dialogs', async () => {
    return await daemon.getDialogs();
  });

  // Daemon status
  ipcMain.handle('get-daemon-status', async () => {
    const health = await daemon.getHealth();
    return health !== null;
  });

  // User info
  ipcMain.handle('get-me', async () => {
    return await daemon.getMe();
  });

  // Close popup (from renderer)
  ipcMain.on('close-popup', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
}
