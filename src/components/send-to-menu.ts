import { el } from "../lib/dom";
import { handoffTargetsFor, stageHandoff, type HandoffTarget } from "../lib/handoff";
import { SAME_TOOL_EVENT, CLOSE_RESULT_EVENT, type OutputFile } from "./output-panel";
import { timelineStore } from "../lib/timeline-store";
import { toast } from "./toast";

export const createSendToMenu = (
  file: OutputFile,
  currentToolId?: string,
  currentFeatureId?: string
): HTMLElement => {
  const fileObj = new File([file.blob], file.name, { type: file.mime });
  // Exclude current tool/feature tab to prevent self-handoff loops
  const targets = handoffTargetsFor(file.mime, currentToolId, currentFeatureId);

  if (!targets.length) {
    return el("span", { class: "muted text-xs" }, ["No handoff tools"]);
  }

  // Group targets by toolId
  const toolGroups = new Map<string, { toolName: string; features: HandoffTarget[] }>();
  for (const t of targets) {
    let g = toolGroups.get(t.toolId);
    if (!g) {
      const toolName = t.label.split("→")[0]?.trim() ?? t.toolId;
      g = { toolName, features: [] };
      toolGroups.set(t.toolId, g);
    }
    g.features.push(t);
  }

  const trigger = el(
    "button",
    {
      class: "btn btn--sm btn--ghost sendto-trigger",
      type: "button"
    },
    [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["shortcut"]),
      "Send to…",
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["arrow_drop_down"])
    ]
  );

  let activeMenu: HTMLElement | null = null;

  const closeMenu = () => {
    if (activeMenu) {
      activeMenu.remove();
      activeMenu = null;
    }
  };

  document.addEventListener("click", (e) => {
    if (activeMenu && !trigger.contains(e.target as Node) && !activeMenu.contains(e.target as Node)) {
      closeMenu();
    }
  });

  const performHandoff = (t: HandoffTarget) => {
    closeMenu();
    stageHandoff(t.toolId, [fileObj]);

    const sourceLabel = currentToolId ?? "Tool";
    const targetLabel = t.label.includes("→") ? t.label.split("→")[1]?.trim() ?? t.featureId : t.featureId;

    window.dispatchEvent(new CustomEvent(CLOSE_RESULT_EVENT));

    const entries = timelineStore.getEntries();
    const parentEntry = entries.find((e) => e.fileName === file.name && e.toolId === (currentToolId ?? ""));

    timelineStore.addEntry({
      toolId: t.toolId,
      featureId: t.featureId,
      sourceLabel,
      targetLabel,
      lineage: "branch",
      parentId: parentEntry?.id ?? null,
      fileName: file.name,
      blob: file.blob,
      mime: file.mime,
      size: file.blob.size
    });

    toast(`Handed off to ${t.label}`, "success");

    if (t.toolId === currentToolId) {
      window.dispatchEvent(
        new CustomEvent(SAME_TOOL_EVENT, { detail: { featureId: t.featureId } })
      );
    } else {
      location.hash = `#/tool/${t.toolId}`;
    }
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeMenu) {
      closeMenu();
      return;
    }

    const menuItems: HTMLElement[] = [];

    toolGroups.forEach((group) => {
      if (group.features.length === 1) {
        const feat = group.features[0];
        const item = el(
          "button",
          { class: "sendto-menu__item", type: "button" },
          [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["build"]),
            el("span", { class: "sendto-menu__label" }, [feat.label])
          ]
        );
        item.addEventListener("click", () => performHandoff(feat));
        menuItems.push(item);
      } else {
        const submenuItems = group.features.map((feat) => {
          const featureLabel = feat.label.includes("→")
            ? feat.label.split("→")[1]?.trim() ?? feat.label
            : feat.label;
          const subItem = el(
            "button",
            { class: "sendto-menu__item", type: "button" },
            [
              el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["tab"]),
              el("span", { class: "sendto-menu__label" }, [featureLabel])
            ]
          );
          subItem.addEventListener("click", (e) => {
            e.stopPropagation();
            performHandoff(feat);
          });
          return subItem;
        });

        const submenu = el("div", { class: "sendto-submenu" }, submenuItems);

        const parentItem = el(
          "div",
          { class: "sendto-menu__item sendto-menu__item--has-sub" },
          [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["folder_open"]),
            el("span", { class: "sendto-menu__label" }, [group.toolName]),
            el("span", { class: "material-symbols-outlined sendto-menu__arrow", "aria-hidden": "true" }, [
              "chevron_right"
            ]),
            submenu
          ]
        );

        parentItem.addEventListener("mouseenter", () => parentItem.classList.add("sendto-menu__item--active"));
        parentItem.addEventListener("mouseleave", () => parentItem.classList.remove("sendto-menu__item--active"));
        menuItems.push(parentItem);
      }
    });

    const menu = el("div", { class: "sendto-menu" }, menuItems);
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 220;
    const margin = 12;
    const menuHeight = menuItems.length * 40 + 16;

    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - menuHeight - 4);
    }

    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin));

    menu.style.position = "fixed";
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.zIndex = "1000";

    document.body.appendChild(menu);
    activeMenu = menu;
  });

  return trigger;
};
