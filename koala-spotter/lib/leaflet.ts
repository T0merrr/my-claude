"use client";

import type * as Leaflet from "leaflet";

let loading: Promise<typeof Leaflet> | null = null;

/** Leaflet touches `window` on import, so it is loaded in the browser only. */
export function loadLeaflet(): Promise<typeof Leaflet> {
  if (!loading) {
    loading = (async () => {
      const L = (await import("leaflet")).default;
      // The cluster plugin attaches itself to the global L.
      (window as unknown as { L: typeof Leaflet }).L = L;
      await import("leaflet.markercluster");
      return L;
    })();
  }
  return loading;
}

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
