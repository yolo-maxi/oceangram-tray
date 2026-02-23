// preload.js — Secure IPC bridge via contextBridge
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oceangram', {
  // Chat popup
  getMessages: (dialogId, limit) => ipcRenderer.invoke('get-messages', dialogId, limit),
  sendMessage: (dialogId, text) => ipcRenderer.invoke('send-message', dialogId, text),
  markRead: (userId) => ipcRenderer.invoke('mark-read', userId),
  getDialogInfo: (dialogId) => ipcRenderer.invoke('get-dialog-info', dialogId),
  getProfilePhoto: (userId) => ipcRenderer.invoke('get-profile-photo', userId),
  closePopup: () => ipcRenderer.send('close-popup'),

  // Whitelist / Settings
  getWhitelist: () => ipcRenderer.invoke('get-whitelist'),
  addUser: (user) => ipcRenderer.invoke('add-user', user),
  removeUser: (userId) => ipcRenderer.invoke('remove-user', userId),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  getDialogs: () => ipcRenderer.invoke('get-dialogs'),
  getDaemonStatus: () => ipcRenderer.invoke('get-daemon-status'),
  getMe: () => ipcRenderer.invoke('get-me'),

  // Events from main → renderer
  onNewMessage: (cb) => {
    ipcRenderer.on('new-message', (_, data) => cb(data));
  },
  onMessagesUpdated: (cb) => {
    ipcRenderer.on('messages-updated', (_, data) => cb(data));
  },
  onConnectionChanged: (cb) => {
    ipcRenderer.on('connection-changed', (_, status) => cb(status));
  },

  // Bubble-specific
  getBubbleData: () => ipcRenderer.invoke('get-bubble-data'),
  bubbleClicked: (userId) => ipcRenderer.send('bubble-clicked', userId),
  onBubbleInit: (cb) => {
    ipcRenderer.on('bubble-init', (_, data) => cb(data));
  },
  onBubbleUpdate: (cb) => {
    ipcRenderer.on('bubble-update', (_, data) => cb(data));
  },

  // Popup-specific
  onPopupInit: (cb) => {
    ipcRenderer.on('popup-init', (_, data) => cb(data));
  },

  // Window control
  startDrag: () => ipcRenderer.send('start-drag'),

  // Login
  loginSuccess: () => ipcRenderer.send('login-success'),
});
