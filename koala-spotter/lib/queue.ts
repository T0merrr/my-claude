"use client";

import { createStore, del, entries, set } from "idb-keyval";
import type { Activity, Source } from "./types";

// Reports are always written here first and sent from here. With a good
// connection that takes a second; with none, the report waits on the phone.

export interface QueuedReport {
  id: string; // also the sighting id, which makes resending safe
  queuedAt: number;
  photo: Blob;
  thumb: Blob;
  lat: number;
  lng: number;
  capturedAt: string;
  locationSource: Source;
  timeSource: Source;
  koalaCount: number | null;
  hasJoey: boolean | null;
  activity: Activity | null;
  trackName: string | null;
  hint: string | null;
  cameraModel: string | null;
  /** Set when the server refused it for a reason retrying will not fix. */
  failed?: string;
  /** Why the last attempt didn't go through, when it will be retried. */
  lastError?: string;
}

const store = typeof indexedDB !== "undefined" ? createStore("maggie-koala", "outbox") : undefined;

export async function enqueue(report: QueuedReport): Promise<void> {
  await set(report.id, report, store);
}

export async function listQueue(): Promise<QueuedReport[]> {
  if (!store) return [];
  const all = await entries<string, QueuedReport>(store);
  return all.map(([, v]) => v).sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function removeFromQueue(id: string): Promise<void> {
  await del(id, store);
}

export async function markFailed(report: QueuedReport, reason: string): Promise<void> {
  await set(report.id, { ...report, failed: reason }, store);
}

export async function noteRetry(report: QueuedReport, reason: string): Promise<void> {
  await set(report.id, { ...report, lastError: reason }, store);
}
