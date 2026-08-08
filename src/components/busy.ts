import { el } from "../lib/dom";

export interface Busy {
  node: HTMLElement;
  /** show indeterminate spinner while work runs */
  spin: (label: string) => void;
  /** show determinate progress 0..1 */
  progress: (ratio: number, label: string) => void;
  done: () => void;
}

/**
 * A busy bar — every file tool must show progress so the user always
 * knows work is happening. Two states: spinner (unknown length) and
 * determinate bar (0..1).
 */
export const busy = (): Busy => {
  const wrap = el("div", { class: "busy", hidden: "hidden" });
  const labelNode = el("span", { class: "muted busy__label" });
  const fill = el("div", { class: "busy__fill" });
  const bar = el("div", { class: "busy__bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, [fill]);
  const spinnerNode = el("span", { class: "spinner__ring", "aria-hidden": "true" });

  const show = (mode: "spin" | "progress") => {
    wrap.hidden = false;
    wrap.replaceChildren(labelNode, mode === "spin" ? spinnerNode : bar);
  };

  return {
    node: wrap,
    spin(label) {
      labelNode.textContent = label;
      show("spin");
    },
    progress(ratio, label) {
      const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
      fill.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", String(pct));
      labelNode.textContent = `${label} ${pct}%`;
      show("progress");
    },
    done() {
      wrap.hidden = true;
      wrap.setAttribute("aria-hidden", "true");
    }
  };
};