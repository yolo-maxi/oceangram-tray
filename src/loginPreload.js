// loginPreload.js — Secure IPC bridge for the login window
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oceangram', {
  // Notify main process that login succeeded
  loginSuccess: () => ipcRenderer.send('login-success'),

  // Close the login window
  closeLogin: () => ipcRenderer.send('close-login'),
});
