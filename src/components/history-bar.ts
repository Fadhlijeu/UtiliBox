import { el } from "../lib/dom";

export interface HistoryCheckpoint {
  label: string;
  undo: () => void;
  redo: () => void;
}

export interface HistoryBarOptions {
  /** Label for initial state, e.g. "Original state" */
  baselineLabel?: string;
  /** Callback when reset is triggered */
  onReset?: () => void;
}

export interface HistoryBarApi {
  node: HTMLElement;
  pushHistory: (cmd: HistoryCheckpoint) => void;
  reset: () => void;
  hasHistory: () => boolean;
}

export const createHistoryBar = (opts: HistoryBarOptions = {}): HistoryBarApi => {
  const root = el("div", { class: "history-bar history-bar--compact", hidden: "hidden" });

  const history: HistoryCheckpoint[] = [];
  const redoStack: HistoryCheckpoint[] = [];
  const baselineLabel = opts.baselineLabel ?? "Original state";

  let activeMenu: HTMLElement | null = null;

  const closeMenus = () => {
    if (activeMenu) {
      activeMenu.remove();
      activeMenu = null;
    }
  };

  document.addEventListener("click", (e) => {
    if (activeMenu && !root.contains(e.target as Node) && !activeMenu.contains(e.target as Node)) {
      closeMenus();
    }
  });

  const runUndoSteps = (count: number) => {
    closeMenus();
    for (let i = 0; i < count && history.length > 0; i++) {
      const cmd = history.pop()!;
      redoStack.push(cmd);
      cmd.undo();
    }
    render();
  };

  const runRedoSteps = (count: number) => {
    closeMenus();
    for (let i = 0; i < count && redoStack.length > 0; i++) {
      const cmd = redoStack.pop()!;
      history.push(cmd);
      cmd.redo();
    }
    render();
  };

  const openUndoMenu = (anchor: HTMLElement) => {
    closeMenus();
    if (history.length === 0) return;

    const items: HTMLElement[] = [];
    // List from top of stack (most recent) down to baseline
    for (let i = history.length - 1; i >= 0; i--) {
      const stepsToUndo = history.length - i;
      const item = el(
        "button",
        {
          class: "history-menu__item",
          type: "button"
        },
        [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["undo"]),
          el("span", { class: "history-menu__label" }, [`Undo: ${history[i].label}`]),
          el("span", { class: "history-menu__step muted" }, [`-${stepsToUndo}`])
        ]
      );
      item.addEventListener("click", () => runUndoSteps(stepsToUndo));
      items.push(item);
    }

    const menu = el("div", { class: "history-menu" }, items);
    positionMenu(menu, anchor);
    document.body.appendChild(menu);
    activeMenu = menu;
  };

  const openRedoMenu = (anchor: HTMLElement) => {
    closeMenus();
    if (redoStack.length === 0) return;

    const items: HTMLElement[] = [];
    // List from top of redo stack (next redo) forward
    for (let i = redoStack.length - 1; i >= 0; i--) {
      const stepsToRedo = redoStack.length - i;
      const item = el(
        "button",
        {
          class: "history-menu__item",
          type: "button"
        },
        [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["redo"]),
          el("span", { class: "history-menu__label" }, [`Redo: ${redoStack[i].label}`]),
          el("span", { class: "history-menu__step muted" }, [`+${stepsToRedo}`])
        ]
      );
      item.addEventListener("click", () => runRedoSteps(stepsToRedo));
      items.push(item);
    }

    const menu = el("div", { class: "history-menu" }, items);
    positionMenu(menu, anchor);
    document.body.appendChild(menu);
    activeMenu = menu;
  };

  const positionMenu = (menu: HTMLElement, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
    menu.style.zIndex = "1000";
  };

  const render = () => {
    const hasAny = history.length > 0 || redoStack.length > 0;
    root.hidden = !hasAny;

    const undoBtn = el(
      "button",
      {
        class: "btn btn--sm btn--ghost history-bar__action",
        type: "button",
        disabled: history.length === 0 ? "" : undefined,
        title: history.length ? `Undo: ${history[history.length - 1].label}` : "Nothing to undo"
      },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["undo"]), "Undo"]
    );
    undoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      runUndoSteps(1);
    });

    const undoMenuBtn = el(
      "button",
      {
        class: "btn btn--sm btn--ghost history-bar__menu-toggle",
        type: "button",
        disabled: history.length === 0 ? "" : undefined,
        title: "Undo checkpoints"
      },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["menu"])]
    );
    undoMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openUndoMenu(undoGroup);
    });

    const undoGroup = el("div", { class: "btn-group" }, [undoBtn, undoMenuBtn]);

    const redoBtn = el(
      "button",
      {
        class: "btn btn--sm btn--ghost history-bar__action",
        type: "button",
        disabled: redoStack.length === 0 ? "" : undefined,
        title: redoStack.length ? `Redo: ${redoStack[redoStack.length - 1].label}` : "Nothing to redo"
      },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["redo"]), "Redo"]
    );
    redoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      runRedoSteps(1);
    });

    const redoMenuBtn = el(
      "button",
      {
        class: "btn btn--sm btn--ghost history-bar__menu-toggle",
        type: "button",
        disabled: redoStack.length === 0 ? "" : undefined,
        title: "Redo checkpoints"
      },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["menu"])]
    );
    redoMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openRedoMenu(redoGroup);
    });

    const redoGroup = el("div", { class: "btn-group" }, [redoBtn, redoMenuBtn]);

    const resetBtn = el(
      "button",
      {
        class: "btn btn--sm btn--ghost",
        type: "button",
        disabled: history.length === 0 ? "" : undefined,
        title: `Reset to ${baselineLabel}`
      },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["restart_alt"]), "Reset"]
    );
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (history.length > 0) {
        runUndoSteps(history.length);
        opts.onReset?.();
      }
    });

    root.replaceChildren(undoGroup, redoGroup, resetBtn);
  };

  const resetAll = () => {
    closeMenus();
    if (history.length > 0) {
      runUndoSteps(history.length);
    }
    history.length = 0;
    redoStack.length = 0;
    opts.onReset?.();
    render();
  };

  render();

  return {
    node: root,
    pushHistory: (cmd: HistoryCheckpoint) => {
      history.push(cmd);
      redoStack.length = 0;
      render();
    },
    reset: resetAll,
    hasHistory: () => history.length > 0 || redoStack.length > 0
  };
};
