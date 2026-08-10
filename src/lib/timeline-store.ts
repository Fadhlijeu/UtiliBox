import { formatBytes } from "./files";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  toolId: string;
  featureId: string;
  sourceLabel?: string;
  targetLabel?: string;
  lineage?: "main" | "branch";
  parentId?: string | null;
  fileName: string;
  blob: Blob;
  mime: string;
  pages?: number;
  size: number;
  formattedSize: string;
  coverCanvas?: HTMLCanvasElement;
  coverUrl?: string;
}

type TimelineListener = (entries: TimelineEntry[]) => void;

class TimelineStore {
  private entries: TimelineEntry[] = [];
  private listeners: Set<TimelineListener> = new Set();
  private lastMainId: string | null = null;

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

  public addEntry(entry: Omit<TimelineEntry, "id" | "timestamp" | "formattedSize">): TimelineEntry {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")} · ${now.getDate()} ${now.toLocaleString("default", { month: "short" })}`;

    const id = `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lineage = entry.lineage ?? "main";
    const parentId = lineage === "branch" ? (entry.parentId ?? this.lastMainId) : null;

    if (lineage === "main") {
      this.lastMainId = id;
    }

    const newEntry: TimelineEntry = {
      ...entry,
      id,
      lineage,
      parentId,
      timestamp,
      formattedSize: formatBytes(entry.size)
    };

    this.entries.unshift(newEntry);
    if (this.entries.length > 30) {
      this.entries.pop();
    }

    this.notify();
    return newEntry;
  }

  public removeEntry(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.notify();
  }

  public clear(): void {
    this.entries = [];
    this.lastMainId = null;
    this.notify();
  }
}

export const timelineStore = new TimelineStore();
