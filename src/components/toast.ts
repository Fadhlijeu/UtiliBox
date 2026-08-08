import { el } from "../lib/dom";

export type ToastKind = "info" | "success" | "error";

let container: HTMLDivElement | null = null;

const getContainer = (): HTMLDivElement => {
  if (!container) {
    container = el("div", { class: "toast-region", role: "status", "aria-live": "polite" });
    document.body.appendChild(container);
  }
  return container;
};

export const toast = (message: string, kind: ToastKind = "info", timeout = 2600): void => {
  const c = getContainer();
  const item = el("div", { class: `toast toast--${kind}`, role: "status" }, [message]);
  c.appendChild(item);
  globalThis.setTimeout(() => {
    item.classList.add("toast--out");
    globalThis.setTimeout(() => item.remove(), 200);
  }, timeout);
};

export const toastSuccess = (m: string) => toast(m, "success");
export const toastError = (m: string) => toast(m, "error");