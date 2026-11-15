export type Source = "exif" | "device" | "manual";
export type Activity = "sleeping" | "awake" | "moving";
export type VoteType = "still_here" | "not_found";
export type FlagReason =
  | "not_a_koala"
  | "wrong_location"
  | "inappropriate"
  | "spam"
  | "other";

export interface Sighting {
  id: string;
  created_at: string;
  captured_at: string;
  lat: number;
  lng: number;
  location_source: Source;
  time_source: Source;
  verified: boolean;
  photo_path: string;
  thumbnail_path: string;
  koala_count: number | null;
  has_joey: boolean | null;
  activity: Activity | null;
  track_name: string | null;
  hint: string | null;
  still_here_count: number;
  not_found_count: number;
  last_confirmed_at: string | null;
  is_mine: boolean;
  my_vote: VoteType | null;
}

export type TimeFilter = "3h" | "today" | "48h";

export interface LatLng {
  lat: number;
  lng: number;
}
