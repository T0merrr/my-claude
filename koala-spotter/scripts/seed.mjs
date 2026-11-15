// Fills the database with sample sightings so the map isn't empty in
// development. Run with:  npm run seed
//
// Uses the service role key, so it must never run in the browser. Safe to
// run again: it removes its own earlier rows first.
//
// The coordinates are approximate and the photos are drawings. Every hint
// starts with "Sample data" so nobody mistakes these for real sightings.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  process.exit(1);
}
if (!/127\.0\.0\.1|localhost/.test(url) && !process.argv.includes("--yes-remote")) {
  console.error(`Refusing to seed ${url}. Sample data is for local development.\nPass --yes-remote if you really mean it.`);
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const BUCKET = "sighting-photos";
const MARK = "Sample data";

// hoursAgo spreads the rows across the map's three age colours. The last
// row is older than 48 hours on purpose: it must NOT appear on the map.
const SIGHTINGS = [
  { lat: -19.1236, lng: 146.8622, hoursAgo: 0.4, track: "Forts Walk", hint: "Right side, about 150 m from the car park, low fork.", count: 1, joey: false, activity: "sleeping", loc: "exif", votes: [1, 0] },
  { lat: -19.1216, lng: 146.8655, hoursAgo: 1.2, track: "Forts Walk", hint: "Left side, 20 m past the second bunker, high fork.", count: 1, joey: true, activity: "awake", loc: "exif", votes: [3, 0] },
  { lat: -19.1201, lng: 146.8681, hoursAgo: 2.5, track: "Forts Walk", hint: "Look up at the bend with the big boulder.", count: 2, joey: false, activity: "sleeping", loc: "device", votes: [0, 0] },
  { lat: -19.1191, lng: 146.8699, hoursAgo: 4, track: "Forts Walk", hint: "Near the lookout steps, tree leaning over the track.", count: 1, joey: false, activity: "sleeping", loc: "exif", votes: [2, 1] },
  { lat: -19.1185, lng: 146.8711, hoursAgo: 6, track: "Forts Walk", hint: "Behind the command post, facing the sea.", count: 1, joey: false, activity: "moving", loc: "manual", votes: [0, 3] },
  { lat: -19.1166, lng: 146.8584, hoursAgo: 9, track: "Horseshoe Bay", hint: "Gum tree beside the footpath, eye level and a bit higher.", count: 1, joey: false, activity: "sleeping", loc: "exif", votes: [1, 0] },
  { lat: -19.1181, lng: 146.8561, hoursAgo: 13, track: "Horseshoe Bay", hint: "Second tree in from the road, curled in the top.", count: 1, joey: false, activity: "sleeping", loc: "device", votes: [0, 0] },
  { lat: -19.1192, lng: 146.8527, hoursAgo: 18, track: "Horseshoe Bay", hint: "Lagoon track, tree with the split trunk.", count: 1, joey: true, activity: "awake", loc: "exif", votes: [0, 1] },
  { lat: -19.1476, lng: 146.8661, hoursAgo: 22, track: "Arcadia", hint: "Across from the bus stop, mid-height branch.", count: 1, joey: false, activity: "sleeping", loc: "exif", votes: [0, 0] },
  { lat: -19.1501, lng: 146.8672, hoursAgo: 26, track: "Geoffrey Bay", hint: "Tree behind the picnic tables.", count: 1, joey: false, activity: "sleeping", loc: "device", votes: [1, 0] },
  { lat: -19.1456, lng: 146.8644, hoursAgo: 30, track: "Arcadia", hint: "Quiet street, look for the grey lump near the top.", count: 2, joey: false, activity: "sleeping", loc: "manual", votes: [0, 2] },
  { lat: -19.1641, lng: 146.8491, hoursAgo: 35, track: "Nelly Bay", hint: "Start of the walking track, left side.", count: 1, joey: false, activity: "awake", loc: "exif", votes: [0, 0] },
  { lat: -19.1664, lng: 146.8471, hoursAgo: 40, track: "Nelly Bay", hint: "About 10 minutes up the track, by the creek crossing.", count: 1, joey: false, activity: "sleeping", loc: "device", votes: [0, 0] },
  { lat: -19.1621, lng: 146.8512, hoursAgo: 44, track: "Nelly Bay", hint: "Tall gum next to the car park.", count: 1, joey: false, activity: "moving", loc: "exif", votes: [1, 1] },
  { lat: -19.1229, lng: 146.8634, hoursAgo: 47, track: "Forts Walk", hint: "Early on the track, right side, quite high.", count: 1, joey: false, activity: "sleeping", loc: "exif", votes: [0, 0] },
  { lat: -19.1208, lng: 146.8668, hoursAgo: 60, track: "Forts Walk", hint: "Older than 48 hours. This row must not show on the public map.", count: 1, joey: false, activity: "sleeping", loc: "exif", votes: [0, 0] },
];

/** A simple drawing of a koala in a tree, varied a little per row. */
function drawing(i) {
  const sky = ["#bfe3f5", "#d8ecd2", "#f6e7c1", "#cfe0ee"][i % 4];
  const leaf = ["#3f7d3a", "#557f2e", "#2f6b47"][i % 3];
  const kx = 420 + ((i * 53) % 260);
  const ky = 300 + ((i * 37) % 160);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="${sky}"/>
  <path d="M${kx + 60} 900 C ${kx + 40} 640, ${kx + 90} 420, ${kx + 70} 0" stroke="#7a5a3c" stroke-width="90" fill="none"/>
  <path d="M${kx + 70} ${ky + 120} C ${kx - 80} ${ky + 60}, ${kx - 220} ${ky - 40}, ${kx - 360} ${ky - 160}" stroke="#7a5a3c" stroke-width="48" fill="none"/>
  <g fill="${leaf}" opacity="0.9">
    <ellipse cx="${kx - 330}" cy="${ky - 190}" rx="170" ry="70"/>
    <ellipse cx="${kx + 260}" cy="150" rx="230" ry="90"/>
    <ellipse cx="${kx - 120}" cy="110" rx="200" ry="80"/>
    <ellipse cx="${kx + 300}" cy="${ky + 260}" rx="180" ry="60"/>
  </g>
  <g transform="translate(${kx - 40} ${ky})">
    <ellipse cx="0" cy="70" rx="78" ry="92" fill="#9ea7ae"/>
    <circle cx="-62" cy="-48" r="38" fill="#9ea7ae"/><circle cx="62" cy="-48" r="38" fill="#9ea7ae"/>
    <circle cx="-62" cy="-48" r="20" fill="#f1d9dc"/><circle cx="62" cy="-48" r="20" fill="#f1d9dc"/>
    <ellipse cx="0" cy="-12" rx="70" ry="62" fill="#b6bec4"/>
    <circle cx="-26" cy="-24" r="8" fill="#1b1b1b"/><circle cx="26" cy="-24" r="8" fill="#1b1b1b"/>
    <ellipse cx="0" cy="6" rx="17" ry="25" fill="#1b1b1b"/>
  </g>
  <rect x="0" y="820" width="1200" height="80" fill="#000" opacity="0.55"/>
  <text x="600" y="872" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">SAMPLE DATA · not a real sighting</text>
</svg>`;
}

async function main() {
  // Remove earlier seed rows and their files.
  const { error: delError } = await supabase.from("sightings").delete().eq("camera_model", MARK);
  if (delError) throw delError;
  const { data: old } = await supabase.storage.from(BUCKET).list("seed", { limit: 1000 });
  if (old?.length) await supabase.storage.from(BUCKET).remove(old.map((f) => `seed/${f.name}`));

  // A few stand-in visitors, so sample sightings can carry votes.
  const voters = [];
  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  for (let i = 1; i <= 3; i++) {
    const email = `seed-visitor-${i}@example.invalid`;
    let user = existing?.users.find((u) => u.email === email);
    if (!user) {
      const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw error;
      user = data.user;
    }
    voters.push(user.id);
  }

  const now = Date.now();
  for (const [i, s] of SIGHTINGS.entries()) {
    const svg = Buffer.from(drawing(i));
    const photo = await sharp(svg).jpeg({ quality: 80 }).toBuffer();
    const thumb = await sharp(svg).resize(480).jpeg({ quality: 72 }).toBuffer();
    const photoPath = `seed/${i}.jpg`;
    const thumbPath = `seed/${i}_t.jpg`;
    for (const [path, body] of [[photoPath, photo], [thumbPath, thumb]]) {
      const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
    }

    const capturedAt = new Date(now - s.hoursAgo * 3600_000).toISOString();
    const { data: row, error } = await supabase
      .from("sightings")
      .insert({
        created_at: capturedAt,
        captured_at: capturedAt,
        location: `SRID=4326;POINT(${s.lng} ${s.lat})`,
        location_source: s.loc,
        time_source: s.loc === "exif" ? "exif" : "device",
        verified: s.loc === "exif",
        photo_path: photoPath,
        thumbnail_path: thumbPath,
        koala_count: s.count,
        has_joey: s.joey,
        activity: s.activity,
        track_name: s.track,
        hint: `${MARK}. ${s.hint}`,
        camera_model: MARK,
        device_id: null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const [stillHere, notFound] = s.votes;
    const votes = [
      ...Array.from({ length: stillHere }, () => "still_here"),
      ...Array.from({ length: notFound }, () => "not_found"),
    ].slice(0, voters.length);
    if (votes.length) {
      const { error: voteError } = await supabase.from("confirmations").insert(
        votes.map((type, v) => ({
          sighting_id: row.id,
          device_id: voters[v],
          type,
          created_at: new Date(now - (s.hoursAgo * 3600_000) / 2).toISOString(),
        })),
      );
      if (voteError) throw voteError;
    }
  }

  console.log(`Seeded ${SIGHTINGS.length} sample sightings (${SIGHTINGS.filter((s) => s.hoursAgo < 48).length} within 48 hours).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
