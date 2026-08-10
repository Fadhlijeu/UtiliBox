import { el } from "../lib/dom";
import { handoffTargetsFor, stageHandoff, type HandoffTarget } from "../lib/handoff";
import { SAME_TOOL_EVENT, type OutputFile } from "./output-panel";
import { timelineStore } from "../lib/timeline-store";
import { toast } from "./toast";

export const createSendToMenu = (
  file: OutputFile,
  currentToolId?: string,
  currentFeatureId?: string
): HTMLElement => {
  const fileObj = new File([file.blob], file.name, { type: file.mime });
  const targets = handoffTargetsFor(file.mime, currentToolId, currentFeatureId);

  if (!targets.length) {
    return el("span", { class: "muted text-xs" }, ["No handoff tools"]);
  }

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

  const updatePosition = () => {
    if (!activeMenu) return;
    const rect = trigger.getBoundingClientRect();

    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      closeMenu();
      return;
    }

    const menuWidth = 220;
    const menuHeight = activeMenu.offsetHeight || 200;
    const margin = 12;

    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - menuHeight - 4);
    }

    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin));

    activeMenu.style.position = "fixed";
    activeMenu.style.top = `${top}px`;
    activeMenu.style.left = `${left}px`;
  };

  const onScrollOrResize = () => updatePosition();

  const closeMenu = () => {
    if (activeMenu) {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
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

    // Set active parent context so target feature logs a single clean branch entry under parent!
    const parentId = (file as any).id ?? timelineStore.getActiveParentId();
    timelineStore.setActiveParent(parentId, file.name, "action");

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

        parentItem.addEventListener("mouseenter", () => {
          parentItem.classList.add("sendto-menu__item--active");
          const pRect = parentItem.getBoundingClientRect();
          const subWidth = 190;
          const margin = 16;
          if (pRect.right + subWidth + margin > window.innerWidth) {
            submenu.classList.add("sendto-submenu--left");
          } else {
            submenu.classList.remove("sendto-submenu--left");
          }
        });
        parentItem.addEventListener("mouseleave", () => parentItem.classList.remove("sendto-menu__item--active"));
        menuItems.push(parentItem);
      }
    });

    const menu = el("div", { class: "sendto-menu" }, menuItems);
    menu.style.zIndex = "1000";

    document.body.appendChild(menu);
    activeMenu = menu;

    updatePosition();

    window.addEventListener("scroll", onScrollOrResize, { capture: true, passive: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });
  });

  return trigger;
};
