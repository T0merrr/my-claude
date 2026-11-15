"use client";

import { useState } from "react";
import { deleteMine, flag, friendlyError, vote } from "@/lib/api";
import { distanceMeters, formatDistance } from "@/lib/island";
import { isConfirmed, isLikelyGone } from "@/lib/status";
import { photoUrl } from "@/lib/supabase";
import { ageBucket, timeAgo } from "@/lib/time";
import type { FlagReason, LatLng, Sighting, VoteType } from "@/lib/types";

const FLAG_REASONS: { value: FlagReason; label: string }[] = [
  { value: "not_a_koala", label: "Not a koala" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "inappropriate", label: "Inappropriate photo" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

const AGE_STYLE = {
  fresh: "bg-fresh text-white",
  today: "bg-today text-white",
  older: "bg-older text-white",
} as const;

interface Props {
  sighting: Sighting;
  userPos: LatLng | null;
  now: number;
  onClose: () => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}

export default function SightingCard({ sighting: s, userPos, now, onClose, onChanged, onToast }: Props) {
  const [busy, setBusy] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const gone = isLikelyGone(s);
  const confirmed = isConfirmed(s);
  const distance = userPos ? distanceMeters(userPos, s) : null;

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await action();
      onToast(done);
      onChanged();
    } catch (err) {
      onToast(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const castVote = (type: VoteType) =>
    run(() => vote(s.id, type), type === "still_here" ? "Thanks. Marked as still here." : "Thanks. Marked as not found.");

  const details = [
    s.koala_count ? `${s.koala_count} koala${s.koala_count > 1 ? "s" : ""}` : null,
    s.has_joey ? "with a joey" : null,
    s.activity,
  ].filter(Boolean);

  return (
    <section
      className="sheet-in absolute inset-x-0 bottom-0 z-30 max-h-[78%] overflow-y-auto rounded-t-2xl border-t-2 border-ink bg-paper shadow-[0_-8px_30px_rgb(0_0_0/0.35)]"
      aria-label="Sighting details"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-paper px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-base font-bold ${AGE_STYLE[ageBucket(s.captured_at, now)]}`}>
            Seen {timeAgo(s.captured_at, now)}
          </span>
          {distance !== null && <span className="text-base font-semibold">{formatDistance(distance)} away</span>}
        </div>
        <button
          onClick={onClose}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-ink text-2xl font-bold"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="space-y-3 px-4 pb-5">
        {gone && (
          <p className="rounded-xl border-2 border-amber-700 bg-amber-100 px-3 py-2 text-base font-semibold text-amber-950">
            Probably moved on. {s.not_found_count} people looked and couldn&apos;t find it.
          </p>
        )}
        {!gone && confirmed && (
          <p className="rounded-xl border-2 border-fresh bg-green-50 px-3 py-2 text-base font-semibold text-green-950">
            ✓ Found by {s.still_here_count} other visitor{s.still_here_count > 1 ? "s" : ""}
            {s.last_confirmed_at ? `, last ${timeAgo(s.last_confirmed_at, now)}` : ""}
          </p>
        )}

        <button
          onClick={() => setZoomed(true)}
          className="block w-full overflow-hidden rounded-xl bg-sand"
          aria-label="Open full-size photo"
        >
          <img
            src={photoUrl(s.thumbnail_path)}
            alt="Photo of the koala sighting"
            className="h-52 w-full object-cover"
          />
        </button>

        {s.hint && (
          <div className="rounded-xl bg-sand px-3 py-2">
            <p className="text-sm font-bold uppercase tracking-wide text-brand">Where to look</p>
            <p className="text-lg leading-snug">{s.hint}</p>
          </div>
        )}

        <p className="text-base">
          {s.track_name && <span className="font-semibold">{s.track_name}. </span>}
          {details.length > 0 && <span className="inline-block first-letter:uppercase">{details.join(", ")}.</span>}
        </p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {s.verified ? (
            <span
              className="rounded-full border border-line px-2.5 py-1 font-semibold"
              title="The location and time were read from the photo's own data. This can be faked, so treat it as a hint."
            >
              Verified: place and time read from the photo
            </span>
          ) : (
            <span className="rounded-full border border-line px-2.5 py-1">
              {s.location_source === "exif"
                ? "Location from the photo"
                : s.location_source === "device"
                  ? "Location from the reporter's phone"
                  : "Location pinned by hand"}
            </span>
          )}
          {(s.still_here_count > 0 || s.not_found_count > 0) && (
            <span className="rounded-full border border-line px-2.5 py-1">
              {s.still_here_count} found it · {s.not_found_count} couldn&apos;t
            </span>
          )}
        </div>

        {s.is_mine ? (
          <div className="rounded-xl border-2 border-line p-3">
            <p className="text-base font-semibold">This is your report.</p>
            {confirmDelete ? (
              <div className="mt-2 flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => run(() => deleteMine(s), "Your report was deleted.").then(onClose)}
                  className="h-12 flex-1 rounded-xl bg-red-700 text-base font-bold text-white disabled:opacity-50"
                >
                  Yes, delete it
                </button>
                <button onClick={() => setConfirmDelete(false)} className="h-12 flex-1 rounded-xl border-2 border-ink text-base font-bold">
                  Keep it
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="mt-2 h-12 w-full rounded-xl border-2 border-red-700 text-base font-bold text-red-800">
                Delete my report
              </button>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-2 text-base font-semibold">Did you go and look?</p>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => castVote("still_here")}
                aria-pressed={s.my_vote === "still_here"}
                className={`h-14 flex-1 rounded-xl border-2 border-fresh text-base font-bold disabled:opacity-50 ${
                  s.my_vote === "still_here" ? "bg-fresh text-white" : "text-green-900"
                }`}
              >
                Still here
              </button>
              <button
                disabled={busy}
                onClick={() => castVote("not_found")}
                aria-pressed={s.my_vote === "not_found"}
                className={`h-14 flex-1 rounded-xl border-2 border-ink text-base font-bold disabled:opacity-50 ${
                  s.my_vote === "not_found" ? "bg-ink text-white" : ""
                }`}
              >
                Couldn&apos;t find it
              </button>
            </div>
          </div>
        )}

        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking`}
          target="_blank"
          rel="noreferrer"
          className="flex h-12 items-center justify-center rounded-xl bg-brand text-base font-bold text-white"
        >
          Walking directions
        </a>

        <p className="rounded-xl bg-sand px-3 py-2 text-sm">
          Stay well back, keep quiet, no flash, and never touch or feed a koala.
        </p>

        {!s.is_mine &&
          (flagging ? (
            <div className="rounded-xl border-2 border-line p-3">
              <p className="mb-2 text-base font-semibold">What&apos;s wrong with this post?</p>
              <div className="grid gap-2">
                {FLAG_REASONS.map((r) => (
                  <button
                    key={r.value}
                    disabled={busy}
                    onClick={() =>
                      run(() => flag(s.id, r.value), "Thanks. We'll take a look.").then(() => setFlagging(false))
                    }
                    className="h-12 rounded-xl border-2 border-ink text-left px-3 text-base font-semibold disabled:opacity-50"
                  >
                    {r.label}
                  </button>
                ))}
                <button onClick={() => setFlagging(false)} className="h-12 text-base font-semibold underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setFlagging(true)} className="h-12 w-full text-base font-semibold text-red-800 underline">
              Report this post
            </button>
          ))}
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black"
          role="dialog"
          aria-label="Full-size photo"
          onClick={() => setZoomed(false)}
        >
          <img src={photoUrl(s.photo_path)} alt="Photo of the koala sighting, full size" className="max-h-full max-w-full object-contain" />
          <button
            className="absolute top-4 right-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl font-bold text-black"
            aria-label="Close photo"
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}
