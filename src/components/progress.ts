import { el } from "../lib/dom";

/**
 * Deterministic progress bar (0..1). No fancy animation — a straight line
 * that says exactly how far the job is.
 */
export const progressBar = (): {
  node: HTMLElement;
  set: (ratio: number) => void;
} => {
  const bar = el("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" });
  const fill = el("div", { class: "progress__fill" });
  bar.appendChild(fill);

  const set = (ratio: number) => {
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    fill.style.width = `${pct}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
  };
  set(0);
  return { node: bar, set };
};

/** Indeterminate spinner for operations without a known end. */
export const spinner = (label = "Working…"): HTMLElement =>
  el("div", { class: "spinner", role: "status" }, [
    el("span", { class: "spinner__ring", "aria-hidden": "true" }),
    el("span", {}, [label])
  ]);

export const statusDot = (tone: "idle" | "success" | "error"): HTMLElement =>
  el("span", { class: `status-dot status-dot--${tone}`, "aria-hidden": "true" });