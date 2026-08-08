// Minimal DOM helper — no framework, just ergonomic constructors.

export type Props = Record<string, string | number | boolean | undefined | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  children?: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k === "class") node.className = String(v);
      else if (k === "dataset" && typeof v === "object") Object.assign(node.dataset, v as Record<string, string>);
      else if (typeof v === "boolean") {
        if (v) node.setAttribute(k, "");
      } else node.setAttribute(k, String(v));
    }
  }
  if (children) append(node, children);
  return node;
}

export function append(parent: Node, children: (Node | string)[]) {
  for (const c of children) {
    parent.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

export function clear(node: HTMLElement | DocumentFragment): void {
  node.replaceChildren();
}

export function on<K extends keyof GlobalEventHandlersEventMap>(
  target: EventTarget,
  type: K,
  handler: (ev: GlobalEventHandlersEventMap[K]) => void,
  options?: AddEventListenerOptions
): () => void {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener);
}

export const setText = (node: HTMLElement, text: string) => {
  node.textContent = text;
};

/** Debounce trailing-edge. Returns cancel-less debounced fn. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => fn(...args), ms);
  };
}

export const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });