"use client";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import { ISLAND_BOUNDS, ISLAND_CENTER } from "@/lib/island";
import { loadLeaflet, TILE_ATTRIBUTION, TILE_URL } from "@/lib/leaflet";
import { isConfirmed, isLikelyGone } from "@/lib/status";
import { ageBucket, shortAge } from "@/lib/time";
import type { LatLng, Sighting } from "@/lib/types";

interface Props {
  sightings: Sighting[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  userPos: (LatLng & { accuracy?: number }) | null;
  /** Changes when the parent wants the map centred on the user. */
  recenterToken: number;
  now: number;
}

export default function MapView({
  sightings,
  selectedId,
  onSelect,
  userPos,
  recenterToken,
  now,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const clusterRef = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const userRef = useRef<{ dot: Leaflet.Marker; ring: Leaflet.Circle } | null>(null);
  const onSelectRef = useRef(onSelect);
  const fitted = useRef(false);
  const latest = useRef({ sightings, selectedId, userPos, now });

  useEffect(() => {
    onSelectRef.current = onSelect;
    latest.current = { sightings, selectedId, userPos, now };
  });

  function drawMarkers() {
    const L = LRef.current;
    const cluster = clusterRef.current;
    if (!L || !cluster) return;
    const { sightings, selectedId, now } = latest.current;
    cluster.clearLayers();
    const markers = sightings.map((s) => {
      const classes = ["koala-pin", ageBucket(s.captured_at, now)];
      if (isLikelyGone(s)) classes.push("gone");
      if (s.id === selectedId) classes.push("selected");
      const tick = isConfirmed(s) ? '<i class="tick">✓</i>' : "";
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="${classes.join(" ")}">${tick}<span>${shortAge(s.captured_at, now)}</span></div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 50],
        }),
        title: `Koala seen ${shortAge(s.captured_at, now)} ago`,
        alt: `Koala sighting, ${shortAge(s.captured_at, now)} ago`,
        keyboard: true,
        zIndexOffset: s.id === selectedId ? 1000 : isLikelyGone(s) ? -500 : 0,
      });
      marker.on("click", () => onSelectRef.current(s.id));
      return marker;
    });
    cluster.addLayers(markers);

    // First time there is something to show, frame it (clear of the bars).
    const map = mapRef.current;
    if (map && !fitted.current && sightings.length > 0) {
      fitted.current = true;
      map.fitBounds(L.latLngBounds(sightings.map((s) => [s.lat, s.lng] as [number, number])), {
        paddingTopLeft: [40, 170],
        paddingBottomRight: [40, 150],
        maxZoom: 16,
        animate: false,
      });
    }
  }

  function drawUser() {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const { userPos } = latest.current;
    if (!userPos) {
      userRef.current?.dot.remove();
      userRef.current?.ring.remove();
      userRef.current = null;
      return;
    }
    const at: [number, number] = [userPos.lat, userPos.lng];
    const radius = Math.min(userPos.accuracy ?? 0, 300);
    if (!userRef.current) {
      userRef.current = {
        ring: L.circle(at, {
          radius,
          color: "#1d4ed8",
          weight: 1,
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(map),
        dot: L.marker(at, {
          icon: L.divIcon({ className: "", html: '<div class="you-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 2000,
          alt: "You are here",
        }).addTo(map),
      };
    } else {
      userRef.current.dot.setLatLng(at);
      userRef.current.ring.setLatLng(at).setRadius(radius);
    }
  }

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    loadLeaflet().then((L) => {
      if (cancelled || !el.current) return;
      LRef.current = L;
      const bounds = L.latLngBounds(
        [ISLAND_BOUNDS.south - 0.02, ISLAND_BOUNDS.west - 0.03],
        [ISLAND_BOUNDS.north + 0.02, ISLAND_BOUNDS.east + 0.03],
      );
      map = L.map(el.current, {
        center: ISLAND_CENTER,
        zoom: 13,
        minZoom: 12,
        maxZoom: 19,
        maxBounds: bounds,
        maxBoundsViscosity: 1,
        zoomControl: false,
      });
      map.attributionControl.setPrefix(false);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      map.on("click", () => onSelectRef.current(null));

      clusterRef.current = L.markerClusterGroup({
        maxClusterRadius: 46,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 18,
        iconCreateFunction: (c) =>
          L.divIcon({
            className: "",
            html: `<div class="koala-cluster" aria-label="${c.getChildCount()} sightings">${c.getChildCount()}</div>`,
            iconSize: [48, 48],
            iconAnchor: [24, 24],
          }),
      }).addTo(map);

      mapRef.current = map;
      drawMarkers();
      drawUser();
      // Lets automated tests reach the map.
      (window as unknown as { __koalaMap?: Leaflet.Map }).__koalaMap = map;
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      clusterRef.current = null;
      userRef.current = null;
    };
  }, []);

  useEffect(() => {
    latest.current = { sightings, selectedId, userPos, now };
    drawMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sightings, selectedId, now]);

  useEffect(() => {
    latest.current = { sightings, selectedId, userPos, now };
    drawUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos]);

  // Bring the selected sighting into view, above the card.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const s = sightings.find((x) => x.id === selectedId);
    if (!s) return;
    const zoom = Math.max(map.getZoom(), 16);
    const point = map.project([s.lat, s.lng], zoom);
    point.y += map.getSize().y * 0.22;
    map.setView(map.unproject(point, zoom), zoom, { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPos || recenterToken === 0) return;
    map.setView([userPos.lat, userPos.lng], Math.max(map.getZoom(), 16), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterToken]);

  return <div ref={el} className="main-map absolute inset-0 z-0" role="application" aria-label="Map of koala sightings on Magnetic Island" />;
}
