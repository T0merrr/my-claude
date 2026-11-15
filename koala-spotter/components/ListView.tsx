"use client";

import { distanceMeters, formatDistance } from "@/lib/island";
import { isConfirmed, isLikelyGone } from "@/lib/status";
import { photoUrl } from "@/lib/supabase";
import { ageBucket, timeAgo } from "@/lib/time";
import type { LatLng, Sighting } from "@/lib/types";

const AGE_STYLE = {
  fresh: "bg-fresh",
  today: "bg-today",
  older: "bg-older",
} as const;

interface Props {
  sightings: Sighting[];
  userPos: LatLng | null;
  locationOff: boolean;
  now: number;
  onSelect: (id: string) => void;
  onFindMe: () => void;
}

/**
 * Sightings several people could not find go to the bottom. Above them the
 * order is nearest first, or newest first when we don't know where you are.
 */
export function sortSightings(sightings: Sighting[], userPos: LatLng | null): Sighting[] {
  return [...sightings].sort((a, b) => {
    const gone = Number(isLikelyGone(a)) - Number(isLikelyGone(b));
    if (gone !== 0) return gone;
    if (userPos) return distanceMeters(userPos, a) - distanceMeters(userPos, b);
    return new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime();
  });
}

export default function ListView({ sightings, userPos, locationOff, now, onSelect, onFindMe }: Props) {
  const sorted = sortSightings(sightings, userPos);
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-paper px-3 pt-32 pb-28">
      <p className="mb-2 px-1 text-base font-semibold">
        {userPos ? "Nearest to you first" : "Newest first"}
        {!userPos && (
          <>
            {" · "}
            {locationOff ? (
              <span className="font-normal">Location is off, so distances can&apos;t be shown.</span>
            ) : (
              <button onClick={onFindMe} className="font-bold text-brand underline">
                Sort by distance
              </button>
            )}
          </>
        )}
      </p>
      <ul className="space-y-2">
        {sorted.map((s) => {
          const gone = isLikelyGone(s);
          return (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s.id)}
                className={`flex w-full items-stretch gap-3 rounded-xl border-2 border-line bg-paper p-2 text-left ${gone ? "opacity-60" : ""}`}
              >
                <img
                  src={photoUrl(s.thumbnail_path)}
                  alt=""
                  loading="lazy"
                  className="h-20 w-20 shrink-0 rounded-lg bg-sand object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold text-white ${AGE_STYLE[ageBucket(s.captured_at, now)]}`}>
                      {timeAgo(s.captured_at, now)}
                    </span>
                    {userPos && <span className="text-base font-bold">{formatDistance(distanceMeters(userPos, s))}</span>}
                  </span>
                  <span className="mt-1 block truncate text-base font-semibold">
                    {s.track_name ?? "Koala sighting"}
                  </span>
                  <span className="block truncate text-sm">
                    {gone
                      ? `Probably moved on (${s.not_found_count} couldn't find it)`
                      : isConfirmed(s)
                        ? `✓ Found by ${s.still_here_count} other${s.still_here_count > 1 ? "s" : ""}`
                        : (s.hint ?? "No hint given")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
