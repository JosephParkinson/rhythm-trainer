/**
 * Installable web app: registers the offline service worker and shows the
 * INSTALL button when the browser offers installation. Production web builds
 * only: not in dev (stale caches get confusing) or in the desktop app.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function setupPwa(installBtn: HTMLButtonElement) {
  installBtn.hidden = true;
  if (!import.meta.env.PROD || !location.protocol.startsWith('http') || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support unavailable; the app still works online */
    });
  });

  let deferred: InstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    installBtn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installBtn.hidden = true;
  });
  installBtn.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    installBtn.hidden = true;
  });
}
