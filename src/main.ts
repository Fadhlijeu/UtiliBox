import { el } from "./lib/dom";
import { renderHome } from "./pages/home";
import { renderToolPage } from "./pages/tool";
import { initTheme, toggleTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/shell.css";
import "./styles/components.css";

/**
 * Root module — shell, router, global search (Cmd/Ctrl+K), theme init.
 * Route format: #/ (home) | #/tool/:id
 */

const historyKey = "utilibox:history";

const updateRecent = (id: string) => {
  const recent: string[] = (() => {
    try {
      return JSON.parse(localStorage.getItem(historyKey) ?? "[]");
    } catch {
      return [];
    }
  })();
  localStorage.setItem(historyKey, JSON.stringify([id, ...recent.filter((x) => x !== id)].slice(0, 8)));
};

// ── Shell builders ────────────────────────────────
function buildHeader(): HTMLElement {
  const search = el("input", {
    type: "search",
    class: "global-search",
    placeholder: "Search tools…  (Ctrl K)",
    "aria-label": "Search tools",
    autocomplete: "off"
  });

  const themeBtn = el("button", {
    class: "icon-btn",
    title: "Toggle theme",
    "aria-label": "Toggle theme"
  }, [el("span", { class: "material-symbols-outlined" }, ["dark_mode"])]);

  themeBtn.addEventListener("click", () => {
    const next = toggleTheme();
    themeBtn.querySelector("span")!.textContent = next === "dark" ? "light_mode" : "dark_mode";
  });

  return el("header", { class: "app-header" }, [
    el("div", { class: "container app-header__inner" }, [
      el("a", { class: "brand", href: "#/" }, [
        el("span", { class: "brand__mark material-symbols-outlined", "aria-hidden": "true" }, ["widgets"]),
        el("span", { class: "brand__name" }, ["UtiliBox"]),
        el("span", { class: "brand__tag muted" }, ["local toolbox"])
      ]),
      search,
      themeBtn
    ])
  ]);
}

// ── router ────────────────────────────────────────
const router = async () => {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/tool\/([a-z0-9-]+)/);
  const main = document.querySelector<HTMLElement>("#app-main")!;
  const search = document.querySelector<HTMLInputElement>(".global-search");

  if (m?.[1]) {
    const id = decodeURIComponent(m[1]);
    updateRecent(id);
    if (search) search.value = "";
    await renderToolPage(main, id);
  } else {
    if (search) search.value = "";
    renderHome(main);
  }
  window.scrollTo(0, 0);
};

function bindGlobalSearch() {
  const search = document.querySelector<HTMLInputElement>(".global-search");
  if (!search) return;
  search.addEventListener("input", () => {
    const q = search.value;
    const main = document.querySelector<HTMLElement>("#app-main")!;
    renderHome(main, q);
  });
  /* open search via Ctrl/Cmd+K */
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      search.focus();
    }
  });
}

export function bootstrap(): void {
  const root = document.getElementById("app")!;
  document.title = "UtiliBox";
  root.appendChild(buildHeader());
  root.appendChild(el("main", { id: "app-main", class: "container" }));
  root.appendChild(
    el("footer", { class: "app-footer" }, [
      el("div", { class: "container" }, [
        el("p", { class: "muted" }, [
          "UtiliBox — your data stays on this device. ",
          el("a", { href: "#/", class: "link" }, ["View source"])
        ])
      ])
    ])
  );
  window.addEventListener("hashchange", router);
  bindGlobalSearch();
  void router();
  initTheme();
}

bootstrap();