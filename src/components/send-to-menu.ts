import { el } from "../lib/dom";
import { handoffTargetsFor, stageHandoff, type HandoffTarget } from "../lib/handoff";
import { SAME_TOOL_EVENT, type OutputFile } from "./output-panel";
import { timelineStore } from "../lib/timeline-store";
import { toast } from "./toast";

export const createSendToMenu = (file: OutputFile, currentToolId?: string): HTMLElement => {
  const fileObj = new File([file.blob], file.name, { type: file.mime });
  const targets = handoffTargetsFor(file.mime, currentToolId, "");

  if (!targets.length) {
    return el("span", { class: "muted text-xs" }, ["No handoff tools"]);
  }

  // Group targets by toolId
  const toolGroups = new Map<string, { toolName: string; features: HandoffTarget[] }>();
  for (const t of targets) {
    let g = toolGroups.get(t.toolId);
    if (!g) {
      // Clean tool name from label (e.g. "Merge & Split → Split" -> "Merge & Split")
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

    // Record in global timeline history
    timelineStore.addEntry({
      toolId: t.toolId,
      featureId: t.featureId,
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
        // Tool with multiple features -> create parent item with flyout submenu
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
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
    menu.style.zIndex = "1000";

    document.body.appendChild(menu);
    activeMenu = menu;
  });

  return trigger;
};
