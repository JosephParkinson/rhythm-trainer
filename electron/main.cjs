// Desktop wrapper: serves the Vite build from a private app:// origin in a Chromium window.
const { app, BrowserWindow, net, protocol, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ALLOWED_PERMISSIONS = new Set(['media', 'midi']);

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

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 1000,
    minWidth: 880,
    backgroundColor: '#1c1d20',
    autoHideMenuBar: true,
    title: 'Rhythm Trainer',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
