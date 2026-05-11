const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

app.name = 'DedTxt';

const isMac = process.platform === 'darwin';

const winState = new Map();

function newState() {
  return {
    filePath: null,
    dirty: false,
    bypassClose: false
  };
}

function getState(win) {
  if (!winState.has(win.id)) winState.set(win.id, newState());
  return winState.get(win.id);
}

function updateTitle(win) {
  const s = getState(win);
  const name = s.filePath ? path.basename(s.filePath) : 'Untitled';
  const dot = s.dirty ? ' •' : '';
  win.setTitle(`${name}${dot} — DedTxt`);
}

function createWindow({ openPath } = {}) {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 320,
    minHeight: 240,
    title: 'DedTxt',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  winState.set(win.id, newState());

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    updateTitle(win);
    if (openPath) loadFileIntoWindow(win, openPath);
  });

  win.on('close', (e) => {
    const s = getState(win);
    if (s.bypassClose) return;
    if (!s.dirty) return;

    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: 'Save changes before closing?',
      detail: s.filePath ? path.basename(s.filePath) : 'Untitled'
    });

    if (choice === 2) return;
    if (choice === 1) {
      s.bypassClose = true;
      win.destroy();
      return;
    }
    win.webContents.send('dt:save-and-close');
  });

  win.on('closed', () => {
    winState.delete(win.id);
  });

  return win;
}

async function loadFileIntoWindow(win, filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const s = getState(win);
    s.filePath = filePath;
    s.dirty = false;
    win.webContents.send('dt:load', { filePath, content });
    updateTitle(win);
    app.addRecentDocument(filePath);
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

async function openFileDialog(win) {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await loadFileIntoWindow(win, result.filePaths[0]);
}

async function writeContent(filePath, content) {
  await fs.writeFile(filePath, content, 'utf-8');
}

async function saveDialog(win) {
  const s = getState(win);
  const defaultPath = s.filePath || 'Untitled.txt';
  const result = await dialog.showSaveDialog(win, { defaultPath });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

function buildMenu() {
  const sendToFocused = (channel) => () => {
    const w = BrowserWindow.getFocusedWindow();
    if (w) w.webContents.send(channel);
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => {
          const w = BrowserWindow.getFocusedWindow() || createWindow();
          openFileDialog(w);
        } },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: sendToFocused('dt:menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: sendToFocused('dt:menu:save-as') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { role: 'front' }] : [])
      ]
    },
    {
      role: 'help',
      submenu: [
        { label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/cportka/dedtxt') }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const pendingFiles = [];

  app.on('second-instance', (_e, argv) => {
    const file = pickFileFromArgv(argv);
    const win = BrowserWindow.getAllWindows()[0] || createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
    if (file) loadFileIntoWindow(win, file);
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && !getState(focused).filePath && !getState(focused).dirty) {
        loadFileIntoWindow(focused, filePath);
      } else {
        createWindow({ openPath: filePath });
      }
    } else {
      pendingFiles.push(filePath);
    }
  });

  app.whenReady().then(() => {
    buildMenu();

    const cliFile = pickFileFromArgv(process.argv);
    if (cliFile) {
      createWindow({ openPath: cliFile });
    } else if (pendingFiles.length) {
      pendingFiles.forEach((f) => createWindow({ openPath: f }));
    } else {
      createWindow();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}

function pickFileFromArgv(argv) {
  const start = app.isPackaged ? 1 : 2;
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    return path.resolve(a);
  }
  return null;
}

ipcMain.handle('dt:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  await openFileDialog(win);
});

ipcMain.handle('dt:open-path', async (e, filePath) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (typeof filePath === 'string' && filePath) {
    await loadFileIntoWindow(win, filePath);
  }
});

ipcMain.handle('dt:save', async (e, content) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const s = getState(win);
  let target = s.filePath;
  if (!target) {
    target = await saveDialog(win);
    if (!target) return { ok: false, canceled: true };
  }
  try {
    await writeContent(target, content);
    s.filePath = target;
    s.dirty = false;
    updateTitle(win);
    app.addRecentDocument(target);
    return { ok: true, filePath: target };
  } catch (err) {
    dialog.showErrorBox('Could not save file', `${target}\n\n${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dt:save-as', async (e, content) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const target = await saveDialog(win);
  if (!target) return { ok: false, canceled: true };
  try {
    await writeContent(target, content);
    const s = getState(win);
    s.filePath = target;
    s.dirty = false;
    updateTitle(win);
    app.addRecentDocument(target);
    return { ok: true, filePath: target };
  } catch (err) {
    dialog.showErrorBox('Could not save file', `${target}\n\n${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.on('dt:dirty', (e, dirty) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const s = getState(win);
  s.dirty = !!dirty;
  updateTitle(win);
});

ipcMain.on('dt:confirm-close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  getState(win).bypassClose = true;
  win.destroy();
});
