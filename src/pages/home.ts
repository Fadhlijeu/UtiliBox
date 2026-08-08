import { TOOLS, CATEGORIES } from "../config/tools";
import { el, clear } from "../lib/dom";

export const renderHome = (root: HTMLElement, query = ""): void => {
  clear(root);
  const q = query.trim().toLowerCase();

  const visible = TOOLS.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  );

  const grid = el("div", { class: "tool-grid" });

  for (const cat of CATEGORIES) {
    const items = visible.filter((t) => t.category === cat.id);
    if (!items.length) continue;
    grid.appendChild(
      el("section", { class: "tool-category" }, [
        el("h2", { class: "tool-category__title" }, [
          el("span", { class: "material-icons-outlined", "aria-hidden": "true" }, [cat.icon]),
          cat.label,
          el("span", { class: "tool-category__count muted" }, [`${items.length}`])
        ]),
        el(
          "div",
          { class: "tool-grid__cards" },
          items.map((t) =>
            el(
              "a",
              {
                class: "tool-card",
                href: `#/tool/${t.id}`,
                "data-tool-id": t.id
              },
              [
                el("span", { class: "tool-card__icon material-icons-outlined", "aria-hidden": "true" }, [t.icon]),
                el("span", { class: "tool-card__body" }, [
                  el("span", { class: "tool-card__title" }, [t.title]),
                  el("span", { class: "tool-card__desc muted" }, [t.description])
                ])
              ]
            )
          )
        )
      ])
    );
  }

  if (!visible.length) {
    root.appendChild(
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-icons-outlined", "aria-hidden": "true" }, ["search_off"]),
        el("p", {}, [`No tools match "${query}".`]),
        el("button", { class: "btn btn--ghost", id: "clear-search" }, ["Clear search"])
      ])
    );
    root.querySelector<HTMLButtonElement>("#clear-search")!.addEventListener("click", () => {
      location.hash = "#/";
    });
  }

  root.appendChild(grid);
};