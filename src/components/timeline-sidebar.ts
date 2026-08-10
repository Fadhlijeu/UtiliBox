import { el } from "../lib/dom";
import { downloadBlob } from "../lib/files";
import { fileThumb } from "../lib/thumb";
import { stageHandoff } from "../lib/handoff";
import { SAME_TOOL_EVENT, CLOSE_RESULT_EVENT } from "./output-panel";
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

  const renderCard = (entry: TimelineEntry, isBranch: boolean): HTMLElement => {
    const thumbSlot = el("span", { class: "timeline-item__thumb" });
    const file = new File([entry.blob], entry.fileName, { type: entry.mime });

    void fileThumb(file).then((t) => {
      if (t?.node) thumbSlot.replaceChildren(t.node);
    });

    const downloadBtn = el(
      "button",
      { class: "btn btn--sm btn--ghost timeline-item__btn", type: "button", title: "Download" },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"])]
    );
    downloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadBlob(entry.blob, entry.fileName);
      toast("Download started", "success");
    });

    const previewBtn = el(
      "button",
      { class: "btn btn--sm btn--ghost timeline-item__btn", type: "button", title: "Preview" },
      [el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["visibility"])]
    );
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openQuickPreview(entry);
    });

    const routeLabel = entry.sourceLabel
      ? entry.targetLabel
        ? `${entry.sourceLabel} ➔ ${entry.targetLabel}`
        : entry.sourceLabel
      : entry.targetLabel
        ? entry.targetLabel
        : entry.featureId;

    const lineageTag = isBranch ? "Branch" : "Main";

    const card = el(
      "div",
      {
        class: `timeline-item ${isBranch ? "timeline-item--branch" : "timeline-item--main"}`,
        tabindex: "0",
        role: "button"
      },
      [
        thumbSlot,
        el("div", { class: "timeline-item__content" }, [
          el("div", { class: "timeline-item__head-line" }, [
            el("span", { class: "timeline-item__name", title: entry.fileName }, [entry.fileName]),
            el(
              "span",
              { class: `timeline-item__badge ${isBranch ? "timeline-item__badge--branch" : "timeline-item__badge--main"}` },
              [isBranch ? `↳ ${lineageTag}` : lineageTag]
            )
          ]),
          el("span", { class: "timeline-item__route muted" }, [routeLabel]),
          el(
            "div",
            { class: "timeline-item__meta" },
            [
              el("span", { class: "muted" }, [entry.timestamp]),
              entry.pages ? el("span", { class: "muted" }, [`${entry.pages} pg`]) : null,
              el("span", { class: "muted" }, [entry.formattedSize])
            ].filter((n): n is HTMLElement => !!n)
          )
        ]),
        el("div", { class: "timeline-item__actions" }, [downloadBtn, previewBtn])
      ]
    );

    const restoreState = () => {
      stageHandoff(entry.toolId, [file]);
      window.dispatchEvent(new CustomEvent(CLOSE_RESULT_EVENT));
      toast(`Restored: ${entry.fileName} (${routeLabel})`, "info");
      const curTool = location.hash.match(/^#\/tool\/([a-z0-9-]+)/)?.[1];
      if (curTool === entry.toolId) {
        window.dispatchEvent(
          new CustomEvent(SAME_TOOL_EVENT, { detail: { featureId: entry.featureId } })
        );
      } else {
        location.hash = `#/tool/${entry.toolId}`;
      }
    };

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
