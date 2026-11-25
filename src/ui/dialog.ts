import { el } from './dom';
import { button } from './widgets';

/** Modal retro window. Returns the body to fill and a close function. */
function openWindow(title: string, onEscape: () => void) {
  const overlay = el('div', 'overlay', document.body);
  const win = el('div', 'window', overlay);
  el('div', 'titlebar', win).textContent = title;
  const body = el('div', 'winbody', win);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
    }
  };
  document.addEventListener('keydown', onKey);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  return { body, close };
}

/** Text prompt; resolves to the trimmed text, or null if cancelled or empty. */
export function promptText(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      close();
      resolve(v);
    };
    const { body, close } = openWindow(title, () => done(null));
    const inp = el('input', 'text', body);
    inp.value = value;
    inp.maxLength = 40;
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && done(inp.value.trim() || null));
    const btns = el('div', 'winbtns', body);
    button(btns, 'OK', () => done(inp.value.trim() || null), 'btn');
    button(btns, 'CANCEL', () => done(null), 'btn');
    inp.focus();
    inp.select();
  });
}

export function confirmBox(text: string, okLabel = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      close();
      resolve(v);
    };
    const { body, close } = openWindow('CONFIRM', () => done(false));
    el('div', 'msg', body).textContent = text;
    const btns = el('div', 'winbtns', body);
    button(btns, okLabel, () => done(true), 'btn').focus();
    button(btns, 'CANCEL', () => done(false), 'btn');
  });
}
