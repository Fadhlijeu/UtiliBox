import { el } from "../lib/dom";
import { downloadBlob, formatBytes } from "../lib/files";
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
      "Click 'Restore & Edit' to load files back into workspace. Click input file pills to preview."
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

  const getActionName = (featureId: string, sourceLabel?: string): string => {
    if (sourceLabel && sourceLabel !== "output" && sourceLabel !== "pdf-organizer") return sourceLabel;
    if (featureId.includes("merge")) return "Merge";
    if (featureId.includes("split")) return "Split";
    if (featureId.includes("organize")) return "Organize";
    if (featureId.includes("compress")) return "Compress";
    if (featureId.includes("convert")) return "Convert Document";
    return "Merge & Split";
  };

  const renderCard = (
    entry: TimelineEntry,
    isBranch: boolean,
    branchLabel?: string
  ): HTMLElement => {
    const file = new File([entry.blob], entry.fileName, { type: entry.mime });

    const downloadBtn = el(
      "button",
      { class: "btn btn--sm btn--ghost timeline-card__icon-btn", type: "button", title: "Download output" },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"])]
    );
    downloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadBlob(entry.blob, entry.fileName);
      toast("Download started", "success");
    });

    const previewBtn = el(
      "button",
      { class: "btn btn--sm btn--ghost timeline-card__icon-btn", type: "button", title: "Preview output" },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["visibility"])]
    );
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFilePreview(file);
    });

    const deleteBtn = el(
      "button",
      {
        class: "btn btn--sm btn--ghost timeline-card__icon-btn timeline-card__icon-btn--delete",
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

    // Inputs: list of interactive pills
    const inputs = entry.inputFiles && entry.inputFiles.length > 0 ? entry.inputFiles : [file];
    const inputPills = inputs.map((f) => {
      const pill = el(
        "button",
        {
          class: "timeline-file-pill",
          type: "button",
          title: `${f.name} (${formatBytes(f.size)}) — Click to preview`
        },
        [
          el("span", { class: "material-symbols-outlined timeline-file-pill__icon" }, ["description"]),
          el("span", { class: "timeline-file-pill__name" }, [f.name])
        ]
      );
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        openFilePreview(f);
      });
      return pill;
    });

    const actionName = getActionName(entry.featureId, entry.sourceLabel);
    const actionIcon = getActionIcon(entry.featureId);

    const restoreBtn = el(
      "button",
      { class: "btn btn--sm btn--primary timeline-btn--restore", type: "button" },
      [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["restore"]),
        "Restore & Edit"
      ]
    );

    const isEditBranch = entry.branchType === "edit";
    const labelText = entry.actionLabel ?? actionName;
    const branchPrefix = isEditBranch ? "↳ ✏️" : "↳ 🚀";
    const badgeText = isBranch
      ? branchLabel
        ? `${branchLabel}: ${labelText}`
        : `${branchPrefix} ${labelText}`
      : "🟢 Main";
    const badgeClass = isBranch
      ? isEditBranch
        ? "timeline-badge--branch-edit"
        : "timeline-badge--branch-action"
      : "timeline-badge--main";

    const card = el(
      "div",
      {
        class: `timeline-card ${isBranch ? "timeline-card--branch" : "timeline-card--main"}`,
        tabindex: "0",
        role: "button"
      },
      [
        // Head bar: lineage badge + timestamp
        el("div", { class: "timeline-card__head" }, [
          el(
            "span",
            { class: `timeline-badge ${badgeClass}` },
            [badgeText]
          ),
          el("span", { class: "timeline-card__time muted" }, [entry.timestamp])
        ]),

        // Section 1: SOURCE FILES (Pill Grid)
        el("div", { class: "timeline-card__section" }, [
          el("div", { class: "timeline-card__section-head" }, [
            el("span", { class: "material-symbols-outlined" }, ["folder_open"]),
            el("span", { class: "timeline-card__section-label" }, [
              `SOURCE (${inputs.length} File${inputs.length > 1 ? "s" : ""})`
            ])
          ]),
          el("div", { class: "timeline-pills-grid" }, inputPills)
        ]),

        // Section 2: ACTION
        el("div", { class: "timeline-card__section" }, [
          el("div", { class: "timeline-card__section-head" }, [
            el("span", { class: "material-symbols-outlined" }, ["bolt"]),
            el("span", { class: "timeline-card__section-label" }, ["ACTION"])
          ]),
          el("div", { class: "timeline-action-pill" }, [
            el("span", { class: "material-symbols-outlined" }, [actionIcon]),
            el("span", { class: "timeline-action-pill__name" }, [actionName]),
            entry.pages ? el("span", { class: "timeline-action-pill__meta" }, [`${entry.pages} pg`]) : null
          ].filter((n): n is HTMLElement => !!n))
        ]),

        // Section 3: OUTPUT FILE
        el("div", { class: "timeline-card__section" }, [
          el("div", { class: "timeline-card__section-head" }, [
            el("span", { class: "material-symbols-outlined" }, ["output"]),
            el("span", { class: "timeline-card__section-label" }, ["OUTPUT"])
          ]),
          el("div", { class: "timeline-output-box" }, [
            el("span", { class: "material-symbols-outlined timeline-output-box__icon" }, ["task_alt"]),
            el("div", { class: "timeline-output-box__info" }, [
              el("span", { class: "timeline-output-box__name", title: entry.fileName }, [entry.fileName]),
              el("span", { class: "timeline-output-box__size muted" }, [entry.formattedSize])
            ])
          ])
        ]),

        // Card footer: Restore & Edit button + Quick Actions
        el("div", { class: "timeline-card__footer" }, [
          restoreBtn,
          el("div", { class: "timeline-card__quick-actions" }, [downloadBtn, previewBtn, deleteBtn])
        ])
      ]
    );

    const restoreState = () => {
      timelineStore.setActiveParent(entry.id, entry.fileName, "edit");
      stageHandoff(entry.toolId, inputs);
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
              inputFiles: inputs,
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

    // Map children by parentId
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

    // Render tree recursively with nested margin-left depth indentation
    const renderTreeNode = (entry: TimelineEntry, depth = 0, treeTag?: string): HTMLElement => {
      const isBranch = entry.lineage === "branch" || depth > 0;
      const cardNode = renderCard(entry, isBranch, treeTag);
      const children = childrenMap.get(entry.id) ?? [];

      if (!children.length) {
        return cardNode;
      }

      const childNodes = children.map((child, idx) => {
        const tag = `↳ Branch #${depth + 1}.${idx + 1}`;
        return renderTreeNode(child, depth + 1, tag);
      });

      const branchGroup = el(
        "div",
        {
          class: "timeline-branch-group",
          style: `margin-left: ${Math.min(depth + 1, 3) * 16}px;`
        },
        [
          el("div", { class: "timeline-branch-connector" }),
          el("div", { class: "timeline-branch-list" }, childNodes)
        ]
      );

      return el("div", { class: "timeline-node-container" }, [cardNode, branchGroup]);
    };

    const renderedNodes = mainEntries.map((mainItem, mIdx) =>
      renderTreeNode(mainItem, 0, `🟢 Main #${mIdx + 1}`)
    );

    listContainer.replaceChildren(...renderedNodes);
  };

  timelineStore.subscribe(renderEntries);

  return root;
};

const openFilePreview = (file: File) => {
  const url = URL.createObjectURL(file);
  const overlay = el("div", { class: "preview-overlay", role: "dialog" }, [
    el("div", { class: "preview-card" }, [
      el("div", { class: "preview-card__head" }, [
        el("span", { class: "preview-card__name" }, [file.name]),
        el("button", { class: "btn btn--sm", type: "button" }, ["Close"])
      ]),
      el("div", { class: "preview-card__body" }, [
        file.type === "application/pdf" || /\.pdf$/i.test(file.name)
          ? el("iframe", { class: "preview-frame", src: url })
          : file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name)
            ? el("img", { class: "preview-image", src: url, alt: file.name })
            : el("p", { class: "muted" }, ["Preview not available for this file type."])
      ])
    ])
  ]);

  overlay.querySelector("button")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
};
