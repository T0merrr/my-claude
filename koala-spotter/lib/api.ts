"use client";

import { ensureDeviceId, getSupabase, PHOTO_BUCKET } from "./supabase";
import {
  listQueue,
  markFailed,
  removeFromQueue,
  type QueuedReport,
} from "./queue";
import type { FlagReason, Sighting, VoteType } from "./types";

const CACHE_KEY = "maggie-koala-sightings";

const FRIENDLY: Record<string, string> = {
  outside_island: "That location is not on Magnetic Island.",
  time_in_future: "The photo's time is in the future. Check your phone's clock.",
  too_old: "That sighting is more than 48 hours old, so it can't be shown.",
  rate_limited: "You've sent a lot in the last hour. Please try again later.",
  own_sighting: "You can't vote on your own report.",
  sighting_gone: "That sighting is no longer on the map.",
  not_signed_in: "Couldn't set up this phone. Check your connection and try again.",
  bad_photo_path: "The photo upload went wrong. Please try again.",
};

/** Server refusals that will never succeed on retry. */
const PERMANENT = new Set(["outside_island", "time_in_future", "too_old", "bad_photo_path"]);

function errorCode(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  return Object.keys(FRIENDLY).find((k) => msg.includes(k)) ?? "";
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = (err as { message?: string } | null)?.message ?? String(err);
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i.test(
    msg,
  );
}

export function friendlyError(err: unknown): string {
  const code = errorCode(err);
  if (code) return FRIENDLY[code];
  if (isNetworkError(err)) return "No connection. Try again when you're back in range.";
  return "Something went wrong. Please try again.";
}

// --- Reading ---------------------------------------------------------------

export function loadCachedSightings(): { sightings: Sighting[]; at: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sightings: Sighting[]; at: number };
    // The 48-hour rule also applies to what this phone remembers.
    const cutoff = Date.now() - 48 * 3600_000;
    return {
      at: parsed.at,
      sightings: parsed.sightings.filter((s) => new Date(s.captured_at).getTime() > cutoff),
    };
  } catch {
    return null;
  }
}

export async function fetchSightings(): Promise<Sighting[]> {
  const { data, error } = await getSupabase().rpc("get_public_sightings");
  if (error) throw error;
  const sightings = (data ?? []) as Sighting[];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ sightings, at: Date.now() }));
  } catch {
    // storage full or blocked: the map still works, just not offline
  }
  return sightings;
}

// --- Writing ---------------------------------------------------------------

async function upload(path: string, blob: Blob): Promise<void> {
  const { error } = await getSupabase()
    .storage.from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  // A retry after a half-finished attempt finds the file already there.
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
}

async function sendReport(r: QueuedReport): Promise<void> {
  const deviceId = await ensureDeviceId();
  const photoPath = `${deviceId}/${r.id}.jpg`;
  const thumbPath = `${deviceId}/${r.id}_t.jpg`;
  await upload(photoPath, r.photo);
  await upload(thumbPath, r.thumb);
  const { error } = await getSupabase().rpc("create_sighting", {
    p_id: r.id,
    p_lat: r.lat,
    p_lng: r.lng,
    p_captured_at: r.capturedAt,
    p_location_source: r.locationSource,
    p_time_source: r.timeSource,
    p_photo_path: photoPath,
    p_thumbnail_path: thumbPath,
    p_koala_count: r.koalaCount,
    p_has_joey: r.hasJoey,
    p_activity: r.activity,
    p_track_name: r.trackName,
    p_hint: r.hint,
    p_camera_model: r.cameraModel,
  });
  if (error) {
    if (PERMANENT.has(errorCode(error))) {
      // The row will never exist, so don't leave its photos behind.
      await getSupabase().storage.from(PHOTO_BUCKET).remove([photoPath, thumbPath]);
    }
    throw error;
  }
}

export interface FlushResult {
  sent: number;
  waiting: number;
  failed: number;
}

let flushing: Promise<FlushResult> | null = null;

/** Sends everything in the outbox. Safe to call often; calls are merged. */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const result: FlushResult = { sent: 0, waiting: 0, failed: 0 };
    for (const report of await listQueue()) {
      if (report.failed) {
        result.failed++;
        continue;
      }
      try {
        await sendReport(report);
        await removeFromQueue(report.id);
        result.sent++;
      } catch (err) {
        if (PERMANENT.has(errorCode(err))) {
          await markFailed(report, friendlyError(err));
          result.failed++;
        } else {
          // No signal, rate limit or a server hiccup: keep it and try later.
          result.waiting++;
          if (isNetworkError(err)) break;
        }
      }
    }
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export async function vote(sightingId: string, type: VoteType): Promise<void> {
  await ensureDeviceId();
  const { error } = await getSupabase().rpc("vote_sighting", {
    p_sighting_id: sightingId,
    p_type: type,
  });
  if (error) throw error;
}

export async function flag(sightingId: string, reason: FlagReason): Promise<void> {
  await ensureDeviceId();
  const { error } = await getSupabase().rpc("flag_sighting", {
    p_sighting_id: sightingId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function deleteMine(s: Sighting): Promise<void> {
  await ensureDeviceId();
  const supabase = getSupabase();
  const { error } = await supabase.rpc("delete_my_sighting", { p_sighting_id: s.id });
  if (error) throw error;
  await supabase.storage.from(PHOTO_BUCKET).remove([s.photo_path, s.thumbnail_path]);
}
