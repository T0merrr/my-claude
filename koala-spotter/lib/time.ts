import type { Sighting, TimeFilter } from "./types";

const HOUR = 3600_000;

export type AgeBucket = "fresh" | "today" | "older";

export function ageHours(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / HOUR;
}

// under 3 hours / 3 to 24 hours / 24 to 48 hours
export function ageBucket(iso: string, now = Date.now()): AgeBucket {
  const h = ageHours(iso, now);
  if (h < 3) return "fresh";
  if (h < 24) return "today";
  return "older";
}

export const FILTER_HOURS: Record<TimeFilter, number> = {
  "3h": 3,
  today: 24,
  "48h": 48,
};

export const FILTER_LABEL: Record<TimeFilter, string> = {
  "3h": "3 hours",
  today: "Today",
  "48h": "48 hours",
};

export function withinFilter(s: Sighting, f: TimeFilter, now = Date.now()) {
  return ageHours(s.captured_at, now) < FILTER_HOURS[f];
}

export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  const rem = hours - days * 24;
  return rem === 0 ? `${days} day ago` : `${days} day ${rem} h ago`;
}

// Short label that fits on a map pin.
export function shortAge(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}
