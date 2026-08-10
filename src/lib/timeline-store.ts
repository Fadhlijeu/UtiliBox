import { formatBytes } from "./files";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  toolId: string;
  featureId: string;
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

    const newEntry: TimelineEntry = {
      ...entry,
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp,
      formattedSize: formatBytes(entry.size)
    };

    // Keep top of list most recent, limit to 20 entries
    this.entries.unshift(newEntry);
    if (this.entries.length > 20) {
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
    this.notify();
  }
}

export const timelineStore = new TimelineStore();
