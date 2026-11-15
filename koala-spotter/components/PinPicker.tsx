"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import { ISLAND_BOUNDS } from "@/lib/island";
import { loadLeaflet, TILE_ATTRIBUTION, TILE_URL } from "@/lib/leaflet";
import type { LatLng } from "@/lib/types";

interface Props {
  value: LatLng;
  /** Zoomed out when the pin still has to be placed by hand. */
  wide: boolean;
  onMove: (pos: LatLng) => void;
}

/** Small map with one pin that can be dragged, or moved by tapping the map. */
export default function PinPicker({ value, wide, onMove }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const onMoveRef = useRef(onMove);
  const initial = useRef({ value, wide });

  useEffect(() => {
    onMoveRef.current = onMove;
  });

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    loadLeaflet().then((L) => {
      if (cancelled || !el.current) return;
      const { value, wide } = initial.current;
      map = L.map(el.current, {
        center: [value.lat, value.lng],
        zoom: wide ? 12 : 17,
        minZoom: 11,
        maxZoom: 19,
        maxBounds: L.latLngBounds(
          [ISLAND_BOUNDS.south - 0.03, ISLAND_BOUNDS.west - 0.04],
          [ISLAND_BOUNDS.north + 0.03, ISLAND_BOUNDS.east + 0.04],
        ),
        zoomControl: true,
      });
      map.attributionControl.setPrefix(false);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      const marker = L.marker([value.lat, value.lng], {
        draggable: true,
        autoPan: true,
        icon: L.divIcon({ className: "", html: '<div class="report-pin"></div>', iconSize: [40, 40], iconAnchor: [20, 46] }),
        alt: "Koala location pin. Drag to move.",
      }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onMoveRef.current({ lat: p.lat, lng: p.lng });
      });
      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        onMoveRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      markerRef.current = marker;
      mapRef.current = map;
      (window as unknown as { __pinMap?: Leaflet.Map }).__pinMap = map;
    });
    return () => {
      cancelled = true;
      map?.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  // Follow changes made outside the map (for example "use my location").
  useEffect(() => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    const cur = marker.getLatLng();
    if (Math.abs(cur.lat - value.lat) > 1e-7 || Math.abs(cur.lng - value.lng) > 1e-7) {
      marker.setLatLng([value.lat, value.lng]);
      map.setView([value.lat, value.lng], Math.max(map.getZoom(), 17));
    }
  }, [value]);

  return (
    <div
      ref={el}
      className="h-56 w-full overflow-hidden rounded-xl border-2 border-ink"
      role="application"
      aria-label="Mini map. Drag the pin or tap the map to set where the koala was."
    />
  );
}
