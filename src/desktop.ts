import { confirmBox } from './ui/dialog';

/** Exposed by electron/preload.cjs in the desktop app; absent on the web. */
interface DesktopApi {
  info(): Promise<{ canUpdate: boolean }>;
  update(): Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

/** Shows UPDATE only in a Mac desktop build that knows where its source checkout is. */
export async function setupUpdate(btn: HTMLButtonElement) {
  btn.hidden = true;
  const api = window.desktop;
  if (!api || !(await api.info()).canUpdate) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    const ok = await confirmBox(
      'UPDATE NOW? THE APP CLOSES, BACKS UP YOUR DATA, REBUILDS FROM THE LATEST CODE AND REOPENS. TAKES A MINUTE OR TWO.',
      'UPDATE',
    );
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = 'UPDATING...';
    const r = await api.update();
    if (!r.ok) {
      btn.disabled = false;
      btn.textContent = 'UPDATE';
      btn.title = r.error ?? 'Update failed';
    }
  });
}
