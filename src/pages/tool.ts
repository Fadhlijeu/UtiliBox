import { toolById, loadToolModule } from "../config/tools";
import { el, clear } from "../lib/dom";

export const renderToolPage = async (root: HTMLElement, id: string): Promise<void> => {
  const meta = toolById(id);
  if (!meta) {
    clear(root);
    root.appendChild(
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-icons-outlined", "aria-hidden": "true" }, ["help"]),
        el("p", {}, [`Tool “${id}” not found.`]),
        el("a", { class: "btn", href: "#/" }, ["Back to home"])
      ])
    );
    return;
  }

  const stage = el("div", {
    class: "tool-stage",
    "data-tool-id": meta.id,
    "aria-busy": "true"
  });
  clear(root);
  root.appendChild(stage);

  try {
    const mod = await loadToolModule(meta.id);
    mod.mount(stage);
    stage.setAttribute("aria-busy", "false");
  } catch {
    stage.replaceChildren(
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-icons-outlined", "aria-hidden": "true" }, ["construction"]),
        el("p", { class: "tool-title" }, [meta.title]),
        el("p", {}, ["This tool is planned but not built yet. Roadmap: ", meta.tier, "."]),
        el("a", { class: "btn", href: "#/" }, ["Back to home"])
      ])
    );
  }
};