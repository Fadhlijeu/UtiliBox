import { el, clear } from "../lib/dom";
import { busy, type Busy } from "./busy";
import { OutputPanel, type OutputFile } from "./output-panel";

export interface Feature {
  id: string;
  label: string;
  /** mounts the feature UI; ctx gives shared services */
  mount: (host: HTMLElement, ctx: FeatureCtx) => void;
}

export interface HistoryCmd {
  label: string;
  undo: () => void;
  redo: () => void;
}

export interface FeatureCtx {
  busy: Busy;
  showResult: (files: OutputFile[]) => void;
  /** push a reversible step; undo/redo buttons appear in the top bar */
  pushHistory: (cmd: HistoryCmd) => void;
  /** wipe history + result view (fresh start) */
  reset: () => void;
}

/**
 * Tool shell — one page per tool, features as tabs on top.
 * Rules: only the ACTIVE feature is visible; results open in a SEPARATE view
 * ("Result" page with Back); Undo/Redo/Reset live in the top bar and only
 * appear once there is something to undo (F-64, F-65).
 */
export const ToolShell = (
  title: string,
  features: Feature[],
  opts: { onReset?: () => void } = {}
) => {
  const root = el("div", { class: "tool-shell" });

  const tabs = el("div", { class: "feature-tabs", role: "tablist" });
  const workspace = el("div", { class: "feature-workspace" });
  const progress = busy();
  const result = OutputPanel();

  const historyBar = el("div", { class: "history-bar", hidden: "hidden" }, []);
  const history: HistoryCmd[] = [];
  const redoStack: HistoryCmd[] = [];
  let hasActivity = false;

  const resultWrap = el("div", { class: "result-view", hidden: "hidden" }, [
    el("div", { class: "result-view__head" }, [
      el("h3", { class: "result-view__title" }, ["Result"]),
      el("button", { class: "btn btn--ghost", type: "button", "data-back": "" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["arrow_back"]),
        "Back to features"
      ])
    ]),
    result.node
  ]);

  resultWrap.querySelector<HTMLButtonElement>("[data-back]")?.addEventListener("click", () => {
    resultWrap.hidden = true;
    workspace.classList.remove("hidden");
    window.scrollTo(0, 0);
  });

  const renderHistory = () => {
    historyBar.hidden = !hasActivity;
    historyBar.replaceChildren(
      el("button", {
        class: "btn btn--sm btn--ghost",
        type: "button",
        disabled: history.length === 0 ? "" : undefined,
        "data-h": "undo",
        title: history.length ? `${history.length} step(s) to undo` : "Nothing to undo"
      }, [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["undo"]), "Undo"]),
      el("button", {
        class: "btn btn--sm btn--ghost",
        type: "button",
        disabled: redoStack.length === 0 ? "" : undefined,
        "data-h": "redo"
      }, [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["redo"]), "Redo"]),
      el("button", {
        class: "btn btn--sm btn--ghost",
        type: "button",
        "data-h": "reset"
      }, [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["restart_alt"]), "Reset"])
    );
  };
  renderHistory();

  historyBar.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-h]");
    if (!btn) return;
    const action = btn.dataset.h;
    if (action === "undo" && history.length) {
      const cmd = history.pop()!;
      redoStack.push(cmd);
      cmd.undo();
      renderHistory();
    } else if (action === "redo" && redoStack.length) {
      const cmd = redoStack.pop()!;
      history.push(cmd);
      cmd.redo();
      renderHistory();
    } else if (action === "reset") {
      clearAll();
    }
  });

  const clearAll = () => {
    history.length = 0;
    redoStack.length = 0;
    result.clear();
    resultWrap.hidden = true;
    workspace.classList.remove("hidden");
    opts.onReset?.();
    hasActivity = false;
    renderHistory();
    mountFeature(current);
  };

  const ctx: FeatureCtx = {
    busy: progress,
    showResult(files) {
      result.show(files);
      workspace.classList.add("hidden");
      resultWrap.hidden = false;
      window.scrollTo(0, 0);
    },
    pushHistory(cmd) {
      hasActivity = true;
      history.push(cmd);
      redoStack.length = 0;
      renderHistory();
    },
    reset: clearAll
  };

  let current = features[0]?.id ?? "";

  const mountFeature = (id: string) => {
    const feat = features.find((f) => f.id === id);
    if (!feat) return;
    clear(workspace);
    feat.mount(workspace, ctx);
  };

  tabs.replaceChildren(
    ...features.map((f) => {
      const tab = el("button", {
        class: "feature-tab",
        type: "button",
        role: "tab",
        "aria-selected": f.id === current ? "true" : "false",
        "data-feature": f.id
      }, [f.label]);
      tab.addEventListener("click", () => {
        if (f.id === current) return;
        current = f.id;
        tabs.querySelectorAll(".feature-tab").forEach((t) => {
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        mountFeature(f.id);
      });
      return tab;
    })
  );

  root.appendChild(el("div", { class: "tool-head" }, [
    el("div", { class: "tool-head__left" }, [
      el("h2", { class: "tool-title" }, [title]),
      el("span", { class: "tool-head__sub muted" }, ["preview first, then download — 100% local"])
    ]),
    historyBar
  ]));
  root.appendChild(tabs);
  root.appendChild(workspace);
  root.appendChild(progress.node);
  root.appendChild(resultWrap);

  mountFeature(current);

  return {
    node: root,
    /** mark that the tool has state worth undoing/resetting (e.g. files added) */
    activity: () => {
      hasActivity = true;
      renderHistory();
    },
    /** switch to a feature (used by handoff of same-tool) */
    activate: (id: string) => {
      const tab = tabs.querySelector<HTMLButtonElement>(`[data-feature="${id}"]`);
      tab?.click();
    },
    /** open the result view with files */
    showResult: ctx.showResult,
    reset: clearAll
  };
};