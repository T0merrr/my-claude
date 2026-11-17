"use client";

import { useEffect, useRef, useState } from "react";
import PinPicker from "./PinPicker";
import { ISLAND_CENTER, isOnIsland } from "@/lib/island";
import { PhotoError, processPhoto, type ProcessedPhoto } from "@/lib/photo";
import { enqueue, type QueuedReport } from "@/lib/queue";
import type { Activity, LatLng, Source } from "@/lib/types";

const HOUR = 3600_000;
const TRACKS = [
  "Forts Walk",
  "Horseshoe Bay",
  "Radical Bay track",
  "Arcadia",
  "Geoffrey Bay",
  "Nelly Bay",
  "Picnic Bay",
  "West Point Road",
];

type Origin = "camera" | "library";

interface Draft {
  photo: ProcessedPhoto;
  previewUrl: string;
  pos: LatLng;
  locationSource: Source;
  /** True until the user places the pin, when we had nothing to start from. */
  needsPin: boolean;
  locationNote: string;
  capturedAt: Date;
  timeSource: Source;
}

function positionOnce(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Asks for a precise GPS fix first. If that is slow or unavailable (common
 * under trees or just after unlocking the phone), settles for a rougher,
 * slightly older position: the visitor confirms the pin anyway.
 */
async function getPosition(): Promise<GeolocationPosition> {
  try {
    return await positionOnce({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  } catch (err) {
    if ((err as GeolocationPositionError).code === 1) throw err; // permission denied
    return await positionOnce({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }
}

/** Where the phone is, from whichever source answers. */
interface PhoneLocation {
  /** A request already running since the report screen opened, if any. */
  warm: Promise<GeolocationPosition> | null;
  /** The "you are here" position from the main map, if it is showing. */
  known: LatLng | null;
}

/** Photo GPS first, then the phone's GPS, then a pin placed by hand. */
async function resolveLocation(
  exif: ProcessedPhoto["exif"],
  origin: Origin,
  phone: PhoneLocation,
): Promise<Pick<Draft, "pos" | "locationSource" | "needsPin" | "locationNote">> {
  // Phones usually remove the location from photos they hand to a website,
  // so on mobile this branch is rare and the phone's own GPS does the work.
  let why = "Your phone didn't pass on this photo's location (phones often remove it for privacy).";
  if (exif.lat !== null && exif.lng !== null) {
    if (isOnIsland(exif.lat, exif.lng)) {
      return {
        pos: { lat: exif.lat, lng: exif.lng },
        locationSource: "exif",
        needsPin: false,
        locationNote: "Location read from your photo. Drag the pin if it's off.",
      };
    }
    why = "The location saved in this photo isn't on Magnetic Island.";
  }

  let here: LatLng | null = null;
  let problem = "";
  try {
    const p = await (phone.warm ?? getPosition()).catch((err) => {
      // The early request failed; ask once more now unless it was refused.
      if ((err as GeolocationPositionError).code === 1 || !phone.warm) throw err;
      return getPosition();
    });
    here = { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch (err) {
    problem =
      (err as GeolocationPositionError).code === 1
        ? "Location permission is off for this site."
        : "We couldn't get your phone's location.";
    here = phone.known;
  }

  if (here && isOnIsland(here.lat, here.lng)) {
    return {
      pos: here,
      locationSource: "device",
      needsPin: false,
      locationNote:
        origin === "camera"
          ? "Using your phone's location. Drag the pin onto the koala's tree if it's off."
          : `${why} Using where you are now instead. Drag the pin if the koala was somewhere else.`,
    };
  }
  if (here) problem = "Your phone doesn't appear to be on the island.";

  return {
    pos: { lat: ISLAND_CENTER[0], lng: ISLAND_CENTER[1] },
    locationSource: "manual",
    needsPin: true,
    locationNote: `${why} ${problem} Zoom in and drag the pin to where you saw the koala.`,
  };
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timeProblem(d: Date): string | null {
  const now = Date.now();
  if (d.getTime() > now + 10 * 60000) return "That time is in the future.";
  if (d.getTime() < now - 48 * HOUR) return "That's more than 48 hours ago. Koalas move on, so only recent sightings are shown.";
  return null;
}

interface Props {
  /** The visitor's position from the main map, when "Find me" is on. */
  knownPos: LatLng | null;
  onClose: () => void;
  onQueued: () => void;
}

export default function ReportSheet({ knownPos, onClose, onQueued }: Props) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [count, setCount] = useState(1);
  const [joey, setJoey] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [track, setTrack] = useState("");
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);
  const warm = useRef<Promise<GeolocationPosition> | null>(null);

  // If location is already allowed, start finding the phone as soon as this
  // screen opens. A GPS fix can take a while, and this way it is usually
  // ready by the time the photo has been chosen.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted" && !warm.current) {
          warm.current = getPosition();
          warm.current.catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (draft) URL.revokeObjectURL(draft.previewUrl);
    };
  }, [draft]);

  async function onFile(file: File | undefined, origin: Origin) {
    if (!file) return;
    setError(null);
    setWorking(true);
    try {
      const photo = await processPhoto(file);

      let capturedAt = new Date();
      let timeSource: Source = origin === "camera" ? "device" : "manual";
      if (photo.exif.takenAt) {
        const problem = timeProblem(photo.exif.takenAt);
        if (problem) {
          const future = photo.exif.takenAt.getTime() > Date.now();
          setError(
            future
              ? "This photo's date is in the future, so it can't be used. Check the clock on your phone or camera."
              : `This photo was taken on ${photo.exif.takenAt.toLocaleDateString(undefined, { day: "numeric", month: "long" })}, more than 48 hours ago. Koalas move on, so only recent sightings are shown.`,
          );
          return;
        }
        capturedAt = photo.exif.takenAt;
        timeSource = "exif";
      }

      const location = await resolveLocation(photo.exif, origin, { warm: warm.current, known: knownPos });
      setDraft({
        photo,
        previewUrl: URL.createObjectURL(photo.thumb),
        capturedAt,
        timeSource,
        ...location,
      });
    } catch (err) {
      const code = err instanceof PhotoError ? err.code : "";
      setError(
        code === "heic_needs_connection"
          ? "This photo format needs a connection to convert. Try again in range, or take the photo with the button above."
          : code === "not_an_image"
            ? "That file isn't a photo."
            : "We couldn't read that photo. Please try another one.",
      );
    } finally {
      setWorking(false);
    }
  }

  function movePin(pos: LatLng) {
    setDraft((d) => {
      if (!d) return d;
      if (!isOnIsland(pos.lat, pos.lng)) {
        return { ...d, pos, needsPin: true, locationSource: "manual", locationNote: "That spot isn't on Magnetic Island. Move the pin back onto the island." };
      }
      return { ...d, pos, needsPin: false, locationSource: "manual", locationNote: "Pin placed by hand." };
    });
  }

  async function useMyLocation() {
    try {
      const p = await getPosition();
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (!isOnIsland(pos.lat, pos.lng)) {
        setDraft((d) => d && { ...d, locationNote: "Your phone doesn't appear to be on Magnetic Island. Place the pin by hand." });
        return;
      }
      setDraft((d) => d && { ...d, pos, needsPin: false, locationSource: "device", locationNote: "Using your phone's location. Drag the pin if it's off." });
    } catch (err) {
      const denied = (err as GeolocationPositionError).code === 1;
      setDraft(
        (d) =>
          d && {
            ...d,
            locationNote: denied
              ? "Location permission is off for this site. Place the pin by hand."
              : "We couldn't get your phone's location. Place the pin by hand.",
          },
      );
    }
  }

  async function submit() {
    if (!draft) return;
    const problem = timeProblem(draft.capturedAt);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const report: QueuedReport = {
      id: crypto.randomUUID(),
      queuedAt: Date.now(),
      photo: draft.photo.photo,
      thumb: draft.photo.thumb,
      lat: draft.pos.lat,
      lng: draft.pos.lng,
      capturedAt: draft.capturedAt.toISOString(),
      locationSource: draft.locationSource,
      timeSource: draft.timeSource,
      koalaCount: count,
      hasJoey: joey,
      activity,
      trackName: track.trim() || null,
      hint: hint.trim() || null,
      cameraModel: draft.photo.exif.cameraModel,
    };
    try {
      await enqueue(report);
      onQueued();
    } catch {
      setError("We couldn't save the report on this phone. If you're in private browsing, try a normal window.");
      setSaving(false);
    }
  }

  const timeError = draft ? timeProblem(draft.capturedAt) : null;
  const canSubmit = Boolean(draft) && !draft!.needsPin && !timeError && !saving;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <header className="flex items-center justify-between border-b-2 border-ink px-4 py-3">
        <h2 id="report-title" className="text-xl font-extrabold">
          Report a koala
        </h2>
        <button onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink text-2xl font-bold" aria-label="Close">
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8">
        <input
          ref={cameraInput}
          data-testid="camera-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0], "camera");
            e.target.value = "";
          }}
        />
        <input
          ref={libraryInput}
          data-testid="library-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0], "library");
            e.target.value = "";
          }}
        />

        {error && (
          <p role="alert" className="mb-4 rounded-xl border-2 border-red-700 bg-red-50 px-3 py-2 text-base font-semibold text-red-900">
            {error}
          </p>
        )}

        {!draft && (
          <div className="space-y-4">
            <p className="rounded-xl bg-sand px-3 py-3 text-base leading-snug">
              <span className="font-bold">Before you get closer:</span> stay well back, no flash, keep quiet, stay on the track. Never touch or feed a koala.
            </p>
            <p className="text-lg font-semibold">A photo is needed so others know it&apos;s real.</p>
            <button
              disabled={working}
              onClick={() => cameraInput.current?.click()}
              className="h-16 w-full rounded-xl bg-brand text-xl font-bold text-white disabled:opacity-50"
            >
              Take a photo
            </button>
            <button
              disabled={working}
              onClick={() => libraryInput.current?.click()}
              className="h-16 w-full rounded-xl border-2 border-ink text-xl font-bold disabled:opacity-50"
            >
              Choose from library
            </button>
            {working && (
              <p role="status" className="text-center text-lg font-semibold">
                Reading your photo and finding the location…
              </p>
            )}
          </div>
        )}

        {draft && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <img src={draft.previewUrl} alt="Your photo" className="h-20 w-20 rounded-lg object-cover" />
              <button
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                className="h-12 rounded-xl border-2 border-ink px-4 text-base font-bold"
              >
                Use a different photo
              </button>
            </div>

            <section aria-labelledby="where-title">
              <h3 id="where-title" className="text-lg font-extrabold">
                1. Check the pin
              </h3>
              <p data-testid="location-note" className={`mb-2 text-base leading-snug ${draft.needsPin ? "font-bold text-red-800" : ""}`}>
                {draft.locationNote}
              </p>
              <PinPicker value={draft.pos} wide={draft.needsPin} onMove={movePin} />
              {draft.locationSource !== "device" && (
                <button onClick={useMyLocation} className="mt-2 h-12 w-full rounded-xl border-2 border-ink text-base font-bold">
                  Use where I am now
                </button>
              )}
            </section>

            <section aria-labelledby="when-title">
              <h3 id="when-title" className="text-lg font-extrabold">
                2. When
              </h3>
              {draft.timeSource === "exif" ? (
                <p className="text-base">
                  {draft.capturedAt.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} (from your photo)
                </p>
              ) : draft.timeSource === "device" ? (
                <p className="text-base">Just now</p>
              ) : (
                <label className="block text-base">
                  This photo has no time saved in it. When did you see the koala?
                  <input
                    type="datetime-local"
                    value={toLocalInput(draft.capturedAt)}
                    max={toLocalInput(new Date())}
                    onChange={(e) => {
                      const d = new Date(e.target.value);
                      if (!Number.isNaN(d.getTime())) setDraft({ ...draft, capturedAt: d });
                    }}
                    className="mt-1 block h-12 w-full rounded-xl border-2 border-ink px-3 text-base"
                  />
                </label>
              )}
              {timeError && <p className="mt-1 text-base font-bold text-red-800">{timeError}</p>}
            </section>

            <section aria-labelledby="details-title" className="space-y-4">
              <h3 id="details-title" className="text-lg font-extrabold">
                3. Help others find it <span className="font-normal">(optional)</span>
              </h3>

              <label className="block text-base font-semibold">
                Where to look
                <textarea
                  value={hint}
                  onChange={(e) => setHint(e.target.value.slice(0, 280))}
                  rows={2}
                  placeholder="e.g. left side, 20 m past the second bunker, high fork"
                  className="mt-1 block w-full rounded-xl border-2 border-ink px-3 py-2 text-base font-normal"
                />
              </label>

              <div className="flex items-center justify-between">
                <span className="text-base font-semibold">How many koalas?</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setCount((c) => Math.max(1, c - 1))} className="h-12 w-12 rounded-full border-2 border-ink text-2xl font-bold" aria-label="One fewer">
                    −
                  </button>
                  <span className="w-6 text-center text-xl font-extrabold" aria-live="polite">
                    {count}
                  </span>
                  <button onClick={() => setCount((c) => Math.min(10, c + 1))} className="h-12 w-12 rounded-full border-2 border-ink text-2xl font-bold" aria-label="One more">
                    +
                  </button>
                </div>
              </div>

              <label className="flex h-12 items-center gap-3 text-base font-semibold">
                <input type="checkbox" checked={joey} onChange={(e) => setJoey(e.target.checked)} className="h-7 w-7 accent-brand" />
                There&apos;s a joey
              </label>

              <fieldset>
                <legend className="mb-1 text-base font-semibold">What was it doing?</legend>
                <div className="flex gap-2">
                  {(["sleeping", "awake", "moving"] as Activity[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={activity === a}
                      onClick={() => setActivity(activity === a ? null : a)}
                      className={`h-12 flex-1 rounded-xl border-2 border-ink text-base font-bold capitalize ${activity === a ? "bg-ink text-white" : ""}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block text-base font-semibold">
                Track or area
                <input
                  list="tracks"
                  value={track}
                  onChange={(e) => setTrack(e.target.value.slice(0, 80))}
                  placeholder="e.g. Forts Walk"
                  className="mt-1 block h-12 w-full rounded-xl border-2 border-ink px-3 text-base font-normal"
                />
                <datalist id="tracks">
                  {TRACKS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
            </section>
          </div>
        )}
      </div>

      {draft && (
        <footer className="border-t-2 border-ink bg-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {draft.needsPin && <p className="mb-2 text-center text-base font-bold text-red-800">Place the pin on the map first.</p>}
          <button
            disabled={!canSubmit}
            onClick={submit}
            className="h-16 w-full rounded-xl bg-brand text-xl font-bold text-white disabled:bg-slate-400"
          >
            {saving ? "Saving…" : "Send report"}
          </button>
        </footer>
      )}
    </div>
  );
}
