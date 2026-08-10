import { formatBytes } from "./files";
import type { OutputFile } from "../components/output-panel";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  toolId: string;
  featureId: string;
  sourceLabel?: string;
  targetLabel?: string;
  lineage?: "main" | "branch";
  branchType?: "edit" | "action";
  actionLabel?: string;
  parentId?: string | null;
  fileName: string;
  blob: Blob;
  mime: string;
  pages?: number;
  size: number;
  formattedSize: string;
  coverCanvas?: HTMLCanvasElement;
  coverUrl?: string;
  inputFiles?: File[];
  outputFiles?: OutputFile[];
}

type TimelineListener = (entries: TimelineEntry[]) => void;

class TimelineStore {
  private entries: TimelineEntry[] = [];
  private listeners: Set<TimelineListener> = new Set();
  private lastMainId: string | null = null;
  private activeParentId: string | null = null;
  private activeParentName: string | null = null;
  private activeBranchType: "edit" | "action" = "edit";

  public subscribe(listener: TimelineListener): () => void {
    this.listeners.add(listener);
    listener([...this.entries]);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const copy = [...this.entries];
    this.listeners.forEach((l) => l(copy));
  }

  public getEntries(): TimelineEntry[] {
    return [...this.entries];
  }

  public setActiveParent(
    parentId: string | null,
    parentName?: string,
    branchType: "edit" | "action" = "edit"
  ): void {
    this.activeParentId = parentId;
    this.activeParentName = parentName ?? (parentId ? "Snapshot" : null);
    this.activeBranchType = branchType;
    this.notify();
  }

  public clearActiveParent(): void {
    this.activeParentId = null;
    this.activeParentName = null;
    this.activeBranchType = "edit";
    this.notify();
  }

  public getActiveParentId(): string | null {
    return this.activeParentId;
  }

  public getActiveParentInfo(): { id: string | null; name: string | null; branchType: "edit" | "action" } {
    return {
      id: this.activeParentId,
      name: this.activeParentName,
      branchType: this.activeBranchType
    };
  }

  public addEntry(entry: Omit<TimelineEntry, "id" | "timestamp" | "formattedSize">): TimelineEntry {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")} · ${now.getDate()} ${now.toLocaleString("default", { month: "short" })}`;

    const id = `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    // Automatically set branch lineage if activeParentId is set
    const lineage: "main" | "branch" = entry.lineage && entry.lineage === "branch" 
      ? "branch" 
      : (this.activeParentId ? "branch" : (entry.lineage ?? "main"));

    const parentId = lineage === "branch" ? (entry.parentId ?? this.activeParentId ?? this.lastMainId) : null;
    const branchType = lineage === "branch" ? (entry.branchType ?? this.activeBranchType) : undefined;

    if (lineage === "main") {
      this.lastMainId = id;
    }

    const newEntry: TimelineEntry = {
      ...entry,
      id,
      lineage,
      branchType,
      parentId,
      timestamp,
      formattedSize: formatBytes(entry.size)
    };

    this.entries.unshift(newEntry);
    if (this.entries.length > 30) {
      this.entries.pop();
    }

    // Advance active parent to the newly created entry
    this.activeParentId = id;
    this.activeParentName = entry.fileName;
    this.activeBranchType = "edit";

    this.notify();
    return newEntry;
  }

  public removeEntry(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.activeParentId === id) {
      this.clearActiveParent();
    } else {
      this.notify();
    }
  }

  public clear(): void {
    this.entries = [];
    this.lastMainId = null;
    this.clearActiveParent();
  }
}

export const timelineStore = new TimelineStore();
