// UtiliBox · Convert Document Tool Studio
import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { formatBytes } from "../../lib/files";
import { takeHandoff } from "../../lib/handoff";
import { SAME_TOOL_EVENT } from "../../components/output-panel";
import type { Busy } from "../../components/busy";
import {
  SUPPORTED_FORMATS,
  normalizeFormat,
  getTargetFormatsFor,
  convertDocument,
  type SupportedFormat
} from "./engine";

export interface StagedConvertEntry {
  id: string;
  file: File;
  data: Uint8Array;
  sourceExt: SupportedFormat;
  targetExt: SupportedFormat;
}

const entries: StagedConvertEntry[] = [];
let notifyActivity: (() => void) | null = null;
const listeners: Array<() => void> = [];

const notify = () => {
  notifyActivity?.();
  listeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
};

const addFiles = async (
  files: FileList | File[],
  ctx: Pick<FeatureCtx, "busy">,
  defaultTarget?: SupportedFormat
): Promise<number> => {
  let count = 0;
  ctx.busy.spin("Loading documents for conversion…");
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const data = new Uint8Array(await readFileAsArrayBuffer(f));
      const sourceExt = normalizeFormat(f.name);
      const availableTargets = getTargetFormatsFor(sourceExt);
      const targetExt = defaultTarget || (availableTargets.length ? availableTargets[0] : "pdf");

      entries.push({
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        data,
        sourceExt,
        targetExt
      });
      count++;
    }
  } finally {
    ctx.busy.done();
    if (count) notify();
  }
  return count;
};

const removeEntry = (index: number) => {
  if (index >= 0 && index < entries.length) {
    entries.splice(index, 1);
    notify();
  }
};

const clearAll = () => {
  entries.length = 0;
  notify();
};

const createStagedFileListView = (filter?: (e: StagedConvertEntry) => boolean) => {
  const host = el("div", { class: "convert-file-list-wrap" });

  const render = () => {
    clear(host);
    const active = filter ? entries.filter(filter) : entries;
    if (!active.length) {
      host.style.display = "none";
      return;
    }
    host.style.display = "block";

    const header = el("div", { class: "convert-deck-header" }, [
      el("div", { class: "row align-center gap-xs" }, [
        el("span", { class: "material-symbols-outlined text-sm text-accent" }, ["inventory_2"]),
        el("span", { class: "font-bold text-xs" }, ["Staged Documents"]),
        el("span", { class: "convert-badge-count" }, [`${active.length} file(s)`])
      ]),
      el("button", {
        class: "btn btn--ghost text-xs text-error",
        type: "button",
        style: "padding: 2px 8px; height: 26px;"
      }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["delete_sweep"]),
        "Clear All"
      ])
    ]);

    header.querySelector("button")?.addEventListener("click", () => clearAll());

    const list = el("div", { class: "convert-file-deck" });

    active.forEach((entry) => {
      const idx = entries.indexOf(entry);
      const availableTargets = getTargetFormatsFor(entry.sourceExt);

      const targetSelect = el("select", { class: "select convert-target-select" }, [
        ...availableTargets.map((tgt) => {
          const opt = el("option", { value: tgt }, [`➔ ${tgt.toUpperCase()}`]) as HTMLOptionElement;
          if (tgt === entry.targetExt) opt.selected = true;
          return opt;
        })
      ]) as HTMLSelectElement;

      targetSelect.addEventListener("change", () => {
        entry.targetExt = targetSelect.value as SupportedFormat;
        notify();
      });

      const removeBtn = el("button", {
        class: "btn btn--ghost convert-file-remove",
        type: "button",
        title: "Remove file"
      }, [
        el("span", { class: "material-symbols-outlined text-sm" }, ["close"])
      ]);

      removeBtn.addEventListener("click", () => removeEntry(idx));

      const sourceMeta = SUPPORTED_FORMATS.find((f) => f.ext === entry.sourceExt);

      const itemCard = el("div", { class: "convert-file-row" }, [
        el("div", { class: "convert-file-left" }, [
          el("div", { class: `convert-format-avatar convert-avatar--${sourceMeta?.category || "doc"}` }, [
            el("span", { class: "material-symbols-outlined text-sm" }, [sourceMeta?.icon || "description"])
          ]),
          el("div", { class: "column" }, [
            el("span", { class: "convert-file-name" }, [entry.file.name]),
            el("div", { class: "row gap-xs align-center text-2xs muted font-mono" }, [
              el("span", { class: "convert-ext-pill" }, [entry.sourceExt.toUpperCase()]),
              "·",
              formatBytes(entry.file.size)
            ])
          ])
        ]),
        el("div", { class: "convert-file-right" }, [
          el("div", { class: "row align-center gap-xs" }, [
            el("span", { class: "muted text-2xs font-bold" }, ["Convert to:"]),
            targetSelect
          ]),
          removeBtn
        ])
      ]);

      list.append(itemCard);
    });

    host.append(header, list);
  };

  listeners.push(render);
  render();
  return { host, render };
};

// ── Feature 1: Universal Converter ────────────────────────────
const universalConvertFeature: Feature = {
  id: "universal-convert",
  label: "Universal Converter",
  mount(host, ctx) {
    let globalTarget: SupportedFormat = "pdf";

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["swap_horiz"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["Universal Document Converter"]),
          el("span", { class: "compress-hero-desc" }, ["Convert PDF, Word (DOCX), Text, Markdown, HTML, RTF, EPUB, CSV, JSON & Images."])
        ])
      ]),
      el("div", { class: "compress-privacy-badge" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["lock"]),
        "100% Local · No Uploads"
      ])
    ]);

    const fileListView = createStagedFileListView();

    const globalTargetSelect = el("select", { class: "select", style: "height: 36px; min-width: 140px; font-weight: 600;" }, [
      ...SUPPORTED_FORMATS.map((f) => {
        const opt = el("option", { value: f.ext }, [`➔ ${f.ext.toUpperCase()} (${f.label.split("(")[0].trim()})`]) as HTMLOptionElement;
        if (f.ext === "pdf") opt.selected = true;
        return opt;
      })
    ]) as HTMLSelectElement;

    globalTargetSelect.addEventListener("change", () => {
      globalTarget = globalTargetSelect.value as SupportedFormat;
      entries.forEach((e) => {
        const available = getTargetFormatsFor(e.sourceExt);
        if (available.includes(globalTarget)) {
          e.targetExt = globalTarget;
        }
      });
      fileListView.render();
    });

    const drop = dropzone({
      label: "Upload files to convert (PDF, DOCX, TXT, MD, HTML, RTF, EPUB, CSV, JSON, XML, Images)",
      accept: "*/*",
      multiple: true,
      onFiles: async (files) => {
        const count = await addFiles(files, ctx, globalTarget);
        toast(`${count} file(s) added`, "success");
      }
    });

    const convertBtn = el("button", {
      class: "btn btn--primary convert-cta-btn",
      type: "button"
    }, [
      el("span", { class: "material-symbols-outlined" }, ["transform"]),
      "Convert Document(s)"
    ]) as HTMLButtonElement;

    convertBtn.addEventListener("click", async () => {
      if (!entries.length) return toast("Upload at least 1 document to convert", "error");
      convertBtn.disabled = true;
      ctx.busy.spin("Converting document(s)…");

      try {
        const outFiles = [];
        for (let i = 0; i < entries.length; i++) {
          const item = entries[i];
          ctx.busy.progress(i / entries.length, `Converting ${item.file.name} to ${item.targetExt.toUpperCase()}…`);
          const res = await convertDocument(item.data, item.sourceExt, item.targetExt, { fileName: item.file.name });
          outFiles.push({
            name: res.name,
            blob: res.blob,
            mime: res.mime,
            sourceFeatureId: "universal-convert",
            sourceLabel: `Converted (${item.sourceExt.toUpperCase()} ➔ ${item.targetExt.toUpperCase()})`
          });
        }

        ctx.showResult(
          outFiles,
          "universal-convert",
          "Convert Document",
          entries.map((e) => e.file),
          `Converted ${entries.length} document(s)`
        );
        toast("Document conversion complete", "success");
      } catch (e) {
        toast(`Conversion failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        convertBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const configCard = el("div", { class: "convert-global-strategy-card" }, [
      el("div", { class: "row justify-between align-center wrap gap-sm" }, [
        el("div", { class: "column gap-2xs" }, [
          el("span", { class: "font-bold text-xs" }, ["Batch Target Format"]),
          el("span", { class: "muted text-2xs" }, ["Apply target format to all convertible files below"])
        ]),
        el("div", { class: "row align-center gap-xs" }, [
          globalTargetSelect,
          convertBtn
        ])
      ])
    ]);

    const studio = el("div", { class: "convert-studio-container" }, [
      heroBanner,
      drop,
      configCard,
      fileListView.host
    ]);

    host.append(studio);

    const updateVisibility = () => {
      configCard.style.display = entries.length > 0 ? "block" : "none";
      fileListView.host.style.display = entries.length > 0 ? "block" : "none";
    };

    listeners.push(updateVisibility);
    updateVisibility();
  }
};

// ── Feature 2: To PDF ─────────────────────────────────────────
const toPdfFeature: Feature = {
  id: "to-pdf",
  label: "To PDF",
  mount(host, ctx) {
    const isToPdf = (e: StagedConvertEntry) => e.sourceExt !== "pdf";

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["picture_as_pdf"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["Convert to PDF"]),
          el("span", { class: "compress-hero-desc" }, ["Convert DOCX, Markdown, Text, HTML, CSV, and Images to standard PDF."])
        ])
      ])
    ]);

    const fileListView = createStagedFileListView(isToPdf);

    const drop = dropzone({
      label: "Upload files to convert to PDF (DOCX, TXT, MD, HTML, CSV, Images)",
      accept: ".docx,.doc,.txt,.md,.html,.htm,.rtf,.epub,.csv,.png,.jpg,.jpeg,.webp,.bmp,.svg",
      multiple: true,
      onFiles: async (files) => {
        const count = await addFiles(files, ctx, "pdf");
        toast(`${count} file(s) added`, "success");
      }
    });

    const convertBtn = el("button", {
      class: "btn btn--primary convert-cta-btn",
      type: "button"
    }, [
      el("span", { class: "material-symbols-outlined" }, ["picture_as_pdf"]),
      "Convert All to PDF"
    ]) as HTMLButtonElement;

    convertBtn.addEventListener("click", async () => {
      const active = entries.filter(isToPdf);
      if (!active.length) return toast("Upload at least 1 document to convert to PDF", "error");
      convertBtn.disabled = true;
      ctx.busy.spin("Generating PDF document(s)…");

      try {
        const outFiles = [];
        for (let i = 0; i < active.length; i++) {
          const item = active[i];
          ctx.busy.progress(i / active.length, `Converting ${item.file.name} to PDF…`);
          const res = await convertDocument(item.data, item.sourceExt, "pdf", { fileName: item.file.name });
          outFiles.push({
            name: res.name,
            blob: res.blob,
            mime: "application/pdf",
            sourceFeatureId: "to-pdf",
            sourceLabel: `Converted to PDF`
          });
        }

        ctx.showResult(outFiles, "to-pdf", "Convert to PDF", active.map((e) => e.file), `Converted ${active.length} file(s) to PDF`);
        toast("Conversion to PDF complete", "success");
      } catch (e) {
        toast(`Conversion failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        convertBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const actionCard = el("div", { class: "convert-global-strategy-card" }, [
      el("div", { class: "row justify-between align-center wrap gap-sm" }, [
        el("div", { class: "column gap-2xs" }, [
          el("span", { class: "font-bold text-xs" }, ["Target: Standard A4 PDF"]),
          el("span", { class: "muted text-2xs" }, ["All uploaded documents will be compiled into clean PDF files"])
        ]),
        convertBtn
      ])
    ]);

    const studio = el("div", { class: "convert-studio-container" }, [
      heroBanner,
      drop,
      actionCard,
      fileListView.host
    ]);

    host.append(studio);

    const updateVisibility = () => {
      const activeCount = entries.filter(isToPdf).length;
      actionCard.style.display = activeCount > 0 ? "block" : "none";
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
    };

    listeners.push(updateVisibility);
    updateVisibility();
  }
};

// ── Feature 3: From PDF ───────────────────────────────────────
const fromPdfFeature: Feature = {
  id: "from-pdf",
  label: "From PDF",
  mount(host, ctx) {
    let targetFormat: SupportedFormat = "docx";
    const isFromPdf = (e: StagedConvertEntry) => e.sourceExt === "pdf";

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["description"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["Convert from PDF"]),
          el("span", { class: "compress-hero-desc" }, ["Extract PDF text into Word (.docx), Markdown (.md), Text, HTML, or EPUB."])
        ])
      ])
    ]);

    const fileListView = createStagedFileListView(isFromPdf);

    const targetSelect = el("select", { class: "select", style: "height: 36px;" }, [
      el("option", { value: "docx" }, ["Word Document (.docx)"]),
      el("option", { value: "md" }, ["Markdown (.md)"]),
      el("option", { value: "txt" }, ["Plain Text (.txt)"]),
      el("option", { value: "html" }, ["HTML Web Page (.html)"]),
      el("option", { value: "rtf" }, ["Rich Text (.rtf)"]),
      el("option", { value: "epub" }, ["EPUB E-Book (.epub)"])
    ]) as HTMLSelectElement;

    targetSelect.addEventListener("change", () => {
      targetFormat = targetSelect.value as SupportedFormat;
      entries.filter(isFromPdf).forEach((e) => { e.targetExt = targetFormat; });
      fileListView.render();
    });

    const drop = dropzone({
      label: "Upload PDF documents to convert (PDF)",
      accept: "application/pdf,.pdf",
      multiple: true,
      onFiles: async (files) => {
        const count = await addFiles(files, ctx, targetFormat);
        toast(`${count} PDF(s) added`, "success");
      }
    });

    const convertBtn = el("button", {
      class: "btn btn--primary convert-cta-btn",
      type: "button"
    }, [
      el("span", { class: "material-symbols-outlined" }, ["transform"]),
      "Convert PDF(s)"
    ]) as HTMLButtonElement;

    convertBtn.addEventListener("click", async () => {
      const active = entries.filter(isFromPdf);
      if (!active.length) return toast("Upload at least 1 PDF file", "error");
      convertBtn.disabled = true;
      ctx.busy.spin("Extracting PDF content…");

      try {
        const outFiles = [];
        for (let i = 0; i < active.length; i++) {
          const item = active[i];
          ctx.busy.progress(i / active.length, `Converting ${item.file.name} to ${item.targetExt.toUpperCase()}…`);
          const res = await convertDocument(item.data, "pdf", item.targetExt, { fileName: item.file.name });
          outFiles.push({
            name: res.name,
            blob: res.blob,
            mime: res.mime,
            sourceFeatureId: "from-pdf",
            sourceLabel: `Extracted from PDF (${item.targetExt.toUpperCase()})`
          });
        }

        ctx.showResult(outFiles, "from-pdf", "Convert from PDF", active.map((e) => e.file), `Extracted ${active.length} PDF(s)`);
        toast("PDF conversion complete", "success");
      } catch (e) {
        toast(`Conversion failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        convertBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const actionCard = el("div", { class: "convert-global-strategy-card" }, [
      el("div", { class: "row justify-between align-center wrap gap-sm" }, [
        el("div", { class: "column gap-2xs" }, [
          el("span", { class: "font-bold text-xs" }, ["Target Output Format"]),
          el("span", { class: "muted text-2xs" }, ["Choose format to extract content from your PDF documents"])
        ]),
        el("div", { class: "row align-center gap-xs" }, [
          targetSelect,
          convertBtn
        ])
      ])
    ]);

    const studio = el("div", { class: "convert-studio-container" }, [
      heroBanner,
      drop,
      actionCard,
      fileListView.host
    ]);

    host.append(studio);

    const updateVisibility = () => {
      const activeCount = entries.filter(isFromPdf).length;
      actionCard.style.display = activeCount > 0 ? "block" : "none";
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
    };

    listeners.push(updateVisibility);
    updateVisibility();
  }
};

// ── Feature 4: Data & Spreadsheets ────────────────────────────
const dataConvertFeature: Feature = {
  id: "data-convert",
  label: "Data & Spreadsheets",
  mount(host, ctx) {
    let targetFormat: SupportedFormat = "json";
    const isData = (e: StagedConvertEntry) => ["csv", "json", "xml", "yaml"].includes(e.sourceExt);

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["table_chart"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["Data & Spreadsheet Interconverter"]),
          el("span", { class: "compress-hero-desc" }, ["Convert between CSV, JSON, YAML, XML, Markdown Tables, and HTML Tables."])
        ])
      ])
    ]);

    const fileListView = createStagedFileListView(isData);

    const targetSelect = el("select", { class: "select", style: "height: 36px;" }, [
      el("option", { value: "json" }, ["JSON Data (.json)"]),
      el("option", { value: "csv" }, ["CSV Spreadsheet (.csv)"]),
      el("option", { value: "yaml" }, ["YAML Config (.yaml)"]),
      el("option", { value: "xml" }, ["XML Document (.xml)"]),
      el("option", { value: "md" }, ["Markdown Table (.md)"]),
      el("option", { value: "html" }, ["HTML Table (.html)"]),
      el("option", { value: "pdf" }, ["PDF Table (.pdf)"])
    ]) as HTMLSelectElement;

    targetSelect.addEventListener("change", () => {
      targetFormat = targetSelect.value as SupportedFormat;
      entries.filter(isData).forEach((e) => { e.targetExt = targetFormat; });
      fileListView.render();
    });

    const drop = dropzone({
      label: "Upload data files (CSV, JSON, YAML, XML)",
      accept: ".csv,.json,.xml,.yaml,.yml",
      multiple: true,
      onFiles: async (files) => {
        const count = await addFiles(files, ctx, targetFormat);
        toast(`${count} data file(s) added`, "success");
      }
    });

    const convertBtn = el("button", {
      class: "btn btn--primary convert-cta-btn",
      type: "button"
    }, [
      el("span", { class: "material-symbols-outlined" }, ["table_view"]),
      "Convert Data File(s)"
    ]) as HTMLButtonElement;

    convertBtn.addEventListener("click", async () => {
      const active = entries.filter(isData);
      if (!active.length) return toast("Upload at least 1 data file (CSV, JSON, YAML, XML)", "error");
      convertBtn.disabled = true;
      ctx.busy.spin("Interconverting data formats…");

      try {
        const outFiles = [];
        for (let i = 0; i < active.length; i++) {
          const item = active[i];
          ctx.busy.progress(i / active.length, `Converting ${item.file.name} to ${item.targetExt.toUpperCase()}…`);
          const res = await convertDocument(item.data, item.sourceExt, item.targetExt, { fileName: item.file.name });
          outFiles.push({
            name: res.name,
            blob: res.blob,
            mime: res.mime,
            sourceFeatureId: "data-convert",
            sourceLabel: `Converted Data (${item.targetExt.toUpperCase()})`
          });
        }

        ctx.showResult(outFiles, "data-convert", "Convert Data", active.map((e) => e.file), `Converted ${active.length} data file(s)`);
        toast("Data conversion complete", "success");
      } catch (e) {
        toast(`Conversion failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        convertBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const actionCard = el("div", { class: "convert-global-strategy-card" }, [
      el("div", { class: "row justify-between align-center wrap gap-sm" }, [
        el("div", { class: "column gap-2xs" }, [
          el("span", { class: "font-bold text-xs" }, ["Target Data Format"]),
          el("span", { class: "muted text-2xs" }, ["Convert spreadsheets, configurations, and structured schemas"])
        ]),
        el("div", { class: "row align-center gap-xs" }, [
          targetSelect,
          convertBtn
        ])
      ])
    ]);

    const studio = el("div", { class: "convert-studio-container" }, [
      heroBanner,
      drop,
      actionCard,
      fileListView.host
    ]);

    host.append(studio);

    const updateVisibility = () => {
      const activeCount = entries.filter(isData).length;
      actionCard.style.display = activeCount > 0 ? "block" : "none";
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
    };

    listeners.push(updateVisibility);
    updateVisibility();
  }
};

// ── Tool Entry ────────────────────────────────────────────────
export const mount = (root: HTMLElement): void => {
  clear(root);
  const shell = ToolShell(
    "Convert Document",
    [universalConvertFeature, toPdfFeature, fromPdfFeature, dataConvertFeature],
    {
      onReset: () => {
        entries.length = 0;
        notify();
      }
    }
  );
  notifyActivity = shell.activity;
  root.append(shell.node);

  const noopBusy: Busy = {
    spin: () => {},
    progress: () => {},
    done: () => {},
    node: el("div")
  };

  const consumeHandoff = async () => {
    const incoming = [
      ...takeHandoff("pdf-convert"),
      ...takeHandoff("convert"),
      ...takeHandoff("document-convert")
    ];
    if (incoming && incoming.length) {
      entries.length = 0;
      await addFiles(incoming, { busy: noopBusy });
      toast(`${incoming.length} file(s) loaded`, "success");
    }
  };

  window.addEventListener(SAME_TOOL_EVENT, (e) => {
    const featureId = (e as CustomEvent<{ featureId?: string }>).detail?.featureId;
    if (featureId) shell.activate(featureId);
    void consumeHandoff();
  });

  void consumeHandoff();
};
