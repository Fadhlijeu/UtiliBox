import { el, clear } from "../lib/dom";
import { busy, type Busy } from "./busy";
import { OutputPanel, type OutputFile, CLOSE_RESULT_EVENT } from "./output-panel";
import { timelineStore } from "../lib/timeline-store";
import { toast } from "./toast";

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
  showResult: (
    files: OutputFile[],
    sourceFeatureId?: string,
    sourceLabel?: string,
    inputFiles?: File[],
    actionLabel?: string
  ) => void;
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

  const history: HistoryCmd[] = [];
  const redoStack: HistoryCmd[] = [];

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

  const closeResult = () => {
    resultWrap.hidden = true;
    workspace.classList.remove("hidden");
  };

  resultWrap.querySelector<HTMLButtonElement>("[data-back]")?.addEventListener("click", () => {
    closeResult();
    window.scrollTo(0, 0);
  });

  const clearAll = () => {
    history.length = 0;
    redoStack.length = 0;
    result.clear();
    closeResult();
    opts.onReset?.();
    mountFeature(current);
  };

  const ctx: FeatureCtx = {
    busy: progress,
    showResult(files, sourceFeatureId?, sourceLabel?, inputFiles?, actionLabel?) {
      result.show(files, sourceFeatureId, sourceLabel, inputFiles, false, actionLabel);
      workspace.classList.add("hidden");
      resultWrap.hidden = false;
      window.scrollTo(0, 0);
    },
    pushHistory(cmd) {
      history.push(cmd);
      redoStack.length = 0;
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
        closeResult();
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
    ])
  ]));

  const envBanner = el("div", { class: "env-banner" });

  const renderEnvBanner = () => {
    const parent = timelineStore.getActiveParentInfo();
    if (!parent.id) {
      envBanner.replaceChildren(
        el("div", { class: "env-banner__pill env-banner__pill--main" }, [
          el("span", { class: "material-symbols-outlined" }, ["add_circle"]),
          el("span", {}, ["Session Mode: New Workspace Session (Will create 🟢 MAIN)"])
        ])
      );
    } else {
      const exitBtn = el(
        "button",
        { class: "btn btn--xs btn--ghost env-banner__exit-btn", type: "button" },
        [
          el("span", { class: "material-symbols-outlined" }, ["close"]),
          "Exit to New Main"
        ]
      );
      exitBtn.addEventListener("click", () => {
        timelineStore.clearActiveParent();
        toast("Exited snapshot environment. Ready for New Main.", "info");
      });

      const icon = parent.branchType === "action" ? "rocket_launch" : "edit";
      envBanner.replaceChildren(
        el("div", { class: "env-banner__pill env-banner__pill--branch" }, [
          el("span", { class: "material-symbols-outlined" }, [icon]),
          el("span", {}, [`Linked to: ${parent.name ?? "Snapshot"} (Will create ↳ Branch)`]),
          exitBtn
        ])
      );
    }
  };

  timelineStore.subscribe(renderEnvBanner);

  root.appendChild(envBanner);
  root.appendChild(tabs);
  root.appendChild(workspace);
  root.appendChild(progress.node);
  root.appendChild(resultWrap);

  mountFeature(current);

  window.addEventListener(CLOSE_RESULT_EVENT, () => {
    closeResult();
    window.scrollTo(0, 0);
  });

  window.addEventListener("utilibox:restore-snapshot", ((e: CustomEvent) => {
    const detail = e.detail;
    if (detail?.outputFiles) {
      result.show(detail.outputFiles, detail.featureId, detail.sourceLabel, detail.inputFiles, true);
      workspace.classList.remove("hidden");
      resultWrap.hidden = false;
      window.scrollTo(0, 0);
    }
  }) as EventListener);

  return {
    node: root,
    /** mark that the tool has state worth undoing/resetting (e.g. files added) */
    activity: () => void 0,
    /** switch to a feature (used by handoff of same-tool) */
    activate: (id: string) => {
      closeResult();
      const tab = tabs.querySelector<HTMLButtonElement>(`[data-feature="${id}"]`);
      tab?.click();
    },
    /** close result view and show workspace */
    closeResult,
    /** open the result view with files */
    showResult: ctx.showResult,
    reset: clearAll
  };
};