// Magnetic Island bounding box. Keep in sync with is_on_island() in
// supabase/migrations. It is a rectangle, not a coastline, so it also
// accepts points in the water close to shore.
export const ISLAND_BOUNDS = {
  south: -19.195,
  north: -19.095,
  west: 146.765,
  east: 146.895,
} as const;

export const ISLAND_CENTER: [number, number] = [-19.14, 146.84];

export function isOnIsland(lat: number, lng: number): boolean {
  return (
    lat >= ISLAND_BOUNDS.south &&
    lat <= ISLAND_BOUNDS.north &&
    lng >= ISLAND_BOUNDS.west &&
    lng <= ISLAND_BOUNDS.east
  );
}

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
