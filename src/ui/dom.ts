export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent.append(e);
  return e;
}
