import type { Sighting } from "./types";

// Other visitors' votes are the strongest signal we have, stronger than the
// "verified" badge, so they drive how a sighting is ranked and drawn.

/** Several people looked and could not find it: draw faded, rank last. */
export function isLikelyGone(s: Sighting): boolean {
  return s.not_found_count >= 2 && s.not_found_count > s.still_here_count;
}

/** At least one other visitor found it, and finders are not outnumbered. */
export function isConfirmed(s: Sighting): boolean {
  return s.still_here_count >= 1 && s.still_here_count >= s.not_found_count;
}
