import { el } from "../lib/dom";
import { downloadBlob } from "../lib/files";
import { stageHandoff } from "../lib/handoff";
import { SAME_TOOL_EVENT } from "./output-panel";
import { timelineStore, type TimelineEntry } from "../lib/timeline-store";
import { toast } from "./toast";

export const TimelineSidebar = (): HTMLElement => {
  const root = el("aside", { class: "timeline-sidebar timeline-sidebar--closed" });

  const toggleBtn = el(
    "button",
    {
      class: "timeline-sidebar__toggle",
      type: "button",
      title: "Toggle File History Timeline",
      "aria-label": "Toggle File History Timeline"
    },
    [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["account_tree"]),
      el("span", { class: "timeline-sidebar__toggle-badge" }, ["0"])
    ]
  );

  const clearBtn = el(
    "button",
    { class: "btn btn--ghost btn--sm timeline-sidebar__clear", type: "button", title: "Clear history graph" },
    [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["delete_sweep"]),
      "Clear"
    ]
  );
  clearBtn.addEventListener("click", () => {
    timelineStore.clear();
    toast("File history graph cleared", "info");
  });

  const head = el("div", { class: "timeline-sidebar__head" }, [
    el("div", { class: "timeline-sidebar__title-wrap" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["account_tree"]),
      el("strong", { class: "timeline-sidebar__title" }, ["File History Graph"])
    ]),
    el("div", { class: "timeline-sidebar__head-actions" }, [
      clearBtn,
      el("button", { class: "btn btn--ghost btn--sm timeline-sidebar__close", type: "button" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["chevron_left"])
      ])
    ])
  ]);

  const listContainer = el("div", { class: "timeline-sidebar__list" });

  const body = el("div", { class: "timeline-sidebar__body" }, [
    el("p", { class: "muted timeline-sidebar__hint" }, [
      "Main outputs & branch lineage history. Click any card to rollback & edit."
    ]),
    listContainer
  ]);

  root.append(toggleBtn, head, body);

  let isOpen = false;

  const toggle = (open?: boolean) => {
    isOpen = open ?? !isOpen;
    root.classList.toggle("timeline-sidebar--open", isOpen);
    root.classList.toggle("timeline-sidebar--closed", !isOpen);
    document.body.classList.toggle("has-timeline-open", isOpen);
  };

  toggleBtn.addEventListener("click", () => toggle());
  head.querySelector(".timeline-sidebar__close")?.addEventListener("click", () => toggle(false));

  const getActionIcon = (featureId: string): string => {
    if (featureId.includes("merge")) return "merge_type";
    if (featureId.includes("split")) return "content_cut";
    if (featureId.includes("organize")) return "grid_view";
    if (featureId.includes("compress")) return "compress";
    if (featureId.includes("convert")) return "transform";
    return "build";
  };

  const renderCard = (entry: TimelineEntry, isBranch: boolean): HTMLElement => {
    const file = new File([entry.blob], entry.fileName, { type: entry.mime });

    const downloadBtn = el(
      "button",
      { class: "btn btn--sm btn--ghost pipeline-card__icon-btn", type: "button", title: "Download output" },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"])]
    );
    downloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadBlob(entry.blob, entry.fileName);
      toast("Download started", "success");
    });

    const previewBtn = el(
      "button",
      { class: "btn btn--sm btn--ghost pipeline-card__icon-btn", type: "button", title: "Quick Preview" },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["visibility"])]
    );
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openQuickPreview(entry);
    });

    const deleteBtn = el(
      "button",
      {
        class: "btn btn--sm btn--ghost pipeline-card__icon-btn pipeline-card__icon-btn--delete",
        type: "button",
        title: "Delete from timeline"
      },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["delete"])]
    );
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      timelineStore.removeEntry(entry.id);
      toast(`Removed ${entry.fileName} from timeline`, "info");
    });

    const inputs = entry.inputFiles ?? [];
    const inputCount = inputs.length > 0 ? inputs.length : 1;
    const inputNames = inputs.length > 0 ? inputs.map((f) => f.name).join(", ") : entry.fileName;
    const inputLabel = inputs.length > 1 ? `${inputCount} Files` : (inputs[0]?.name ?? entry.fileName);

    const actionName = entry.sourceLabel ?? entry.featureId ?? "Process";
    const actionIcon = getActionIcon(entry.featureId);

    const restoreBtn = el(
      "button",
      { class: "btn btn--sm btn--primary pipeline-btn--restore", type: "button" },
      [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["restore"]),
        "Restore & Edit"
      ]
    );

    const card = el(
      "div",
      {
        class: `pipeline-card ${isBranch ? "pipeline-card--branch" : "pipeline-card--main"}`,
        tabindex: "0",
        role: "button"
      },
      [
        // Head bar: lineage badge + timestamp
        el("div", { class: "pipeline-card__head" }, [
          el(
            "span",
            { class: `pipeline-badge ${isBranch ? "pipeline-badge--branch" : "pipeline-badge--main"}` },
            [isBranch ? "↳ Branch" : "🟢 Main"]
          ),
          el("span", { class: "pipeline-card__time muted" }, [entry.timestamp])
        ]),

        // Visual Pipeline Chain: Input -> Action -> Output
        el("div", { class: "pipeline-chain" }, [
          // Step 1: Input
          el("div", { class: "pipeline-step pipeline-step--input", title: `Input: ${inputNames}` }, [
            el("span", { class: "material-symbols-outlined pipeline-step__icon" }, ["folder_open"]),
            el("span", { class: "pipeline-step__title" }, ["Input"]),
            el("span", { class: "pipeline-step__desc" }, [inputLabel])
          ]),

          // Arrow 1
          el("div", { class: "pipeline-arrow" }, [
            el("span", { class: "material-symbols-outlined" }, ["arrow_forward"])
          ]),

          // Step 2: Action
          el("div", { class: "pipeline-step pipeline-step--action" }, [
            el("span", { class: "material-symbols-outlined pipeline-step__icon" }, [actionIcon]),
            el("span", { class: "pipeline-step__title" }, [actionName]),
            el("span", { class: "pipeline-step__desc" }, [entry.pages ? `${entry.pages} pg` : "Ready"])
          ]),

          // Arrow 2
          el("div", { class: "pipeline-arrow" }, [
            el("span", { class: "material-symbols-outlined" }, ["arrow_forward"])
          ]),

          // Step 3: Output
          el("div", { class: "pipeline-step pipeline-step--output", title: `Output: ${entry.fileName}` }, [
            el("span", { class: "material-symbols-outlined pipeline-step__icon" }, ["description"]),
            el("span", { class: "pipeline-step__title" }, ["Output"]),
            el("span", { class: "pipeline-step__desc" }, [entry.fileName])
          ])
        ]),

        // Card footer: Restore & Edit button + Quick Actions
        el("div", { class: "pipeline-card__footer" }, [
          restoreBtn,
          el("div", { class: "pipeline-card__quick-actions" }, [downloadBtn, previewBtn, deleteBtn])
        ])
      ]
    );

    const restoreState = () => {
      const activeInputFiles =
        entry.inputFiles && entry.inputFiles.length > 0 ? entry.inputFiles : [file];

      stageHandoff(entry.toolId, activeInputFiles);
      toast(`Restored history: ${entry.fileName}`, "info");

      const outputFiles = entry.outputFiles ?? [
        {
          name: entry.fileName,
          blob: entry.blob,
          mime: entry.mime,
          sourceFeatureId: entry.featureId,
          sourceLabel: entry.sourceLabel
        }
      ];

      const curTool = location.hash.match(/^#\/tool\/([a-z0-9-]+)/)?.[1];
      if (curTool === entry.toolId) {
        window.dispatchEvent(
          new CustomEvent(SAME_TOOL_EVENT, { detail: { featureId: entry.featureId } })
        );
      } else {
        location.hash = `#/tool/${entry.toolId}`;
      }

      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("utilibox:restore-snapshot", {
            detail: {
              toolId: entry.toolId,
              featureId: entry.featureId,
              inputFiles: activeInputFiles,
              outputFiles
            }
          })
        );
      }, 50);
    };

    restoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      restoreState();
    });

    card.addEventListener("click", restoreState);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        restoreState();
      }
    });

    return card;
  };

  const renderEntries = (entries: TimelineEntry[]) => {
    const badge = toggleBtn.querySelector(".timeline-sidebar__toggle-badge");
    if (badge) badge.textContent = String(entries.length);

    if (!entries.length) {
      listContainer.replaceChildren(
        el("div", { class: "timeline-empty" }, [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["account_tree"]),
          "No output history graph yet."
        ])
      );
      return;
    }

    // Separate main entries and child branch entries by parentId
    const childrenMap = new Map<string, TimelineEntry[]>();
    const mainEntries: TimelineEntry[] = [];

    entries.forEach((e) => {
      if (e.lineage === "branch" && e.parentId) {
        const list = childrenMap.get(e.parentId) ?? [];
        list.push(e);
        childrenMap.set(e.parentId, list);
      } else {
        mainEntries.push(e);
      }
    });

    const renderedNodes: HTMLElement[] = [];

    mainEntries.forEach((mainItem) => {
      const mainCard = renderCard(mainItem, false);
      const branches = childrenMap.get(mainItem.id) ?? [];

      if (!branches.length) {
        renderedNodes.push(mainCard);
      } else {
        const branchCards = branches.map((b) => renderCard(b, true));
        const branchGroup = el(
          "div",
          { class: "timeline-branch-group" },
          [
            el("div", { class: "timeline-branch-connector" }),
            el("div", { class: "timeline-branch-list" }, branchCards)
          ]
        );

        const nodeContainer = el("div", { class: "timeline-node-container" }, [
          mainCard,
          branchGroup
        ]);
        renderedNodes.push(nodeContainer);
      }
    });

    listContainer.replaceChildren(...renderedNodes);
  };

  timelineStore.subscribe(renderEntries);

  return root;
};

const openQuickPreview = (entry: TimelineEntry) => {
  const url = URL.createObjectURL(entry.blob);
  const overlay = el("div", { class: "preview-overlay", role: "dialog" }, [
    el("div", { class: "preview-card" }, [
      el("div", { class: "preview-card__head" }, [
        el("span", { class: "preview-card__name" }, [entry.fileName]),
        el("button", { class: "btn btn--sm", type: "button" }, ["Close"])
      ]),
      el("div", { class: "preview-card__body" }, [
        entry.mime === "application/pdf"
          ? el("iframe", { class: "preview-frame", src: url })
          : entry.mime.startsWith("image/")
            ? el("img", { class: "preview-image", src: url, alt: entry.fileName })
            : el("p", { class: "muted" }, ["Preview not available."])
      ])
    ])
  ]);

  overlay.querySelector("button")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
};
