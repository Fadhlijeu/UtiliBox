import { TOOLS, CATEGORIES } from "../config/tools";
import { el, clear } from "../lib/dom";

export const renderHome = (root: HTMLElement, query = ""): void => {
  clear(root);
  const q = query.trim().toLowerCase();

  const visible = TOOLS.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  );

  // ── Hero Section (Shadcn Layout) ─────────────────────────────────
  const heroSection = el("section", { class: "home-hero" }, [
    el("div", { class: "home-hero__badge-pill" }, [
      el("span", { class: "material-symbols-outlined text-xs" }, ["shield_lock"]),
      "100% Local Client-Side Engine"
    ]),
    el("h1", { class: "home-hero__title" }, ["All-in-One Utility Powerbox"]),
    el("p", { class: "home-hero__subtitle" }, [
      "Compress PDF/images/audio/video, organize PDF pages, encode Base64, and format JSON — zero server uploads, 100% private."
    ]),
    el("div", { class: "home-hero__features" }, [
      featurePill("bolt", "Instant Local Processing"),
      featurePill("track_changes", "Precision Target Engine"),
      featurePill("cloud_off", "No Data Uploaded"),
      featurePill("devices", "Offline PWA Ready")
    ])
  ]);

  const grid = el("div", { class: "tool-grid" });

  for (const cat of CATEGORIES) {
    const items = visible.filter((t) => t.category === cat.id);
    if (!items.length) continue;
    grid.appendChild(
      el("section", { class: "tool-category" }, [
        el("div", { class: "tool-category__head" }, [
          el("h2", { class: "tool-category__title" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, [cat.icon]),
            cat.label
          ]),
          el("span", { class: "tool-category__count" }, [`${items.length} Tool(s)`])
        ]),
        el(
          "div",
          { class: "tool-grid__cards" },
          items.map((t) =>
            el(
              "a",
              {
                class: "shadcn-tool-card",
                href: `#/tool/${t.id}`,
                "data-tool-id": t.id
              },
              [
                el("div", { class: "shadcn-tool-card__head" }, [
                  el("div", { class: "shadcn-tool-card__icon-box" }, [
                    el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, [t.icon])
                  ]),
                  el("span", { class: "shadcn-tool-card__tag" }, ["Utility"])
                ]),
                el("div", { class: "shadcn-tool-card__body" }, [
                  el("h3", { class: "shadcn-tool-card__title" }, [t.title]),
                  el("p", { class: "shadcn-tool-card__desc" }, [t.description])
                ]),
                el("div", { class: "shadcn-tool-card__footer" }, [
                  el("span", { class: "shadcn-tool-card__action" }, [
                    "Launch Tool",
                    el("span", { class: "material-symbols-outlined text-xs" }, ["arrow_forward"])
                  ])
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
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["search_off"]),
        el("p", {}, [`No tools match "${query}".`]),
        el("button", { class: "btn btn--ghost", id: "clear-search" }, ["Clear search"])
      ])
    );
    root.querySelector<HTMLButtonElement>("#clear-search")!.addEventListener("click", () => {
      location.hash = "#/";
    });
  } else {
    root.appendChild(heroSection);
  }

  root.appendChild(grid);
};

const featurePill = (icon: string, text: string): HTMLElement => {
  return el("div", { class: "home-hero__pill" }, [
    el("span", { class: "material-symbols-outlined text-xs" }, [icon]),
    el("span", {}, [text])
  ]);
};