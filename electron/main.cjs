// Desktop wrapper: serves the Vite build from a private app:// origin in a Chromium window.
const { app, BrowserWindow, ipcMain, net, protocol, session, shell, systemPreferences } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pkg = require('../package.json');

const DIST = path.join(__dirname, '..', 'dist');
// Chromium asks for Web MIDI as 'midiSysex' even when the page doesn't request sysex.
const ALLOWED_PERMISSIONS = new Set(['media', 'midi', 'midiSysex']);

// A standard, secure scheme gives the page a stable origin (so localStorage
// persists across launches) and counts as a secure context (mic, MIDI, AudioWorklet).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveDist() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(pathname === '/' ? path.join(DIST, 'index.html') : file).toString());
  });
}

// The UPDATE button rebuilds from the source checkout this app was built from.
// Packaged builds record its path at build time (extraMetadata.repoPath, see package.json scripts).
const REPO = app.isPackaged ? pkg.repoPath : path.join(__dirname, '..');
const UPDATE_SCRIPT = REPO ? path.join(REPO, 'scripts', 'update-mac.sh') : null;
const canUpdate = () => process.platform === 'darwin' && !!UPDATE_SCRIPT && fs.existsSync(UPDATE_SCRIPT);
const fromApp = (e) => e.senderFrame?.url.startsWith('app://rhythm-trainer/') ?? false;

ipcMain.handle('desktop:info', (e) => ({ canUpdate: fromApp(e) && canUpdate() }));
ipcMain.handle('desktop:update', (e) => {
  if (!fromApp(e) || !canUpdate()) return { ok: false, error: 'UPDATE UNAVAILABLE' };
  // A login shell picks up the user's PATH (node, npm, git). The script quits
  // this app itself, so it runs detached and outlives it.
  spawn('/bin/zsh', ['-lc', 'exec /bin/bash "$0"', UPDATE_SCRIPT], { cwd: REPO, detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 1000,
    minWidth: 880,
    backgroundColor: '#1c1d20',
    autoHideMenuBar: true,
    title: 'Rhythm Trainer',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadURL('app://rhythm-trainer/');
  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  serveDist();
  // Only the microphone (calibration) and MIDI are ever needed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone').catch(() => false);

  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
