# Maggie Koala Spotter

A mobile-first web app where visitors on Magnetic Island report koala sightings, with a photo, and browse recent ones on a map. Sightings disappear from the public map 48 hours after they were seen.

- Next.js (App Router), TypeScript, Tailwind
- Leaflet with OpenStreetMap tiles (no API key)
- Supabase: Postgres + PostGIS, Storage, anonymous auth
- Installable PWA with an offline outbox for reports

## Run it locally

You need Node 20+ and Docker (for the local Supabase stack).

```bash
npm install
```

```bash
npm run db:start
```

`db:start` prints the local keys (`npx supabase status` shows them again): an anon or publishable key, and a service_role or secret key. Copy `.env.example` to `.env.local` and paste them in, then pick any `ADMIN_PASSWORD`.

```bash
cp .env.example .env.local
```

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:3000. The admin page is at http://localhost:3000/admin.

The service worker (offline support) only runs in a production build:

```bash
npm run build && npm run start
```

Other commands: `npm run db:reset` wipes the local database and reapplies the schema, `npm run db:stop` stops the stack, `npm run lint` runs ESLint.

## Environment variables

| Name | Where it is used | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser and server | The public key: "publishable" (`sb_publishable_…`) or legacy "anon" |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | The secret key: "secret" (`sb_secret_…`) or legacy "service_role". Used by the admin page and the seed script |
| `ADMIN_PASSWORD` | server only | Password for `/admin`. Use a long random one |

## How it works

**Identity.** There is no sign-up. The first time a phone sends a report or a vote it gets an anonymous Supabase user, stored in that browser. That user id is the `device_id`. Browsing the map needs no identity at all.

**Reporting.** The photo's EXIF (GPS, capture time, camera model) is read in the browser. The image is then redrawn through a canvas at 1600 px and 480 px, which drops all metadata, and only those copies are uploaded. Location falls back from photo GPS, to the phone's GPS, to a pin placed by hand. The pin is always shown for confirmation.

**Offline.** Every report is written to an outbox in IndexedDB first and sent from there. With no signal it waits, and is retried when the phone comes back online, when the app is reopened, and every 30 seconds while the app is open. The service worker caches the app itself, map tiles already viewed and photos already viewed. The last list of sightings is kept in localStorage.

**Trust.** "Verified" means the location and time were both read from the photo, the location is on the island, and the photo was taken within 24 hours of upload. The browser reports those sources, so it can be faked: the badge is drawn as a small neutral label. Votes from other visitors count for more. A sighting found by others gets a tick and a green banner; one that two or more people couldn't find (and more than found it) is faded and sorted last.

**Moderation.** Three flags from different devices hide a post until an admin reviews it. `/admin` lists everything, including hidden posts and posts older than 48 hours, and can hide, unhide or delete.

## Database

The schema is one migration: `supabase/migrations/20261115000000_init.sql`.

| Table | Columns |
| --- | --- |
| `sightings` | `id`, `created_at`, `captured_at`, `location` (geography point), `location_source`, `time_source`, `verified`, `photo_path`, `thumbnail_path`, `koala_count`, `has_joey`, `activity`, `track_name`, `hint`, `camera_model`, `device_id`, `hidden`, `hidden_reason`, `reviewed_at` |
| `confirmations` | `id`, `sighting_id`, `device_id`, `type` (`still_here` / `not_found`), `created_at`. One per device per sighting |
| `flags` | `id`, `sighting_id`, `device_id`, `reason`, `created_at`. One per device per sighting |

Row-level security is on for all three tables. A device can read only its own rows and cannot write to any table directly. All access goes through these functions:

| Function | Who can call it | What it enforces |
| --- | --- | --- |
| `get_public_sightings()` | anyone | Returns only posts that are not hidden and were seen in the last 48 hours. Never returns `device_id` |
| `create_sighting(...)` | signed-in device | On the island, not in the future, not older than 48 hours, photo in the caller's own folder, max 6 per hour and 20 per day per device. Sets `verified` |
| `vote_sighting(id, type)` | signed-in device | Not your own post, post still public, max 40 per hour |
| `flag_sighting(id, reason)` | signed-in device | Max 10 per hour. Hides the post at 3 flags unless an admin has reviewed it |
| `delete_my_sighting(id)` | signed-in device | Only the device that created it |
| `admin_list_sightings()` | service role only | Everything, for the admin page |

Photos live in the public `sighting-photos` bucket: JPEG only, 3 MB cap, and a device can write and delete only inside its own folder.

The island boundary is a rectangle, defined twice and kept in sync by hand: `lib/island.ts` and `is_on_island()` in the migration.

## Create the hosted Supabase project

1. Go to https://supabase.com, sign in and create a new project. Pick the Sydney region and save the database password it asks for.
2. In the dashboard open **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. The app cannot post without this.
3. Open **Project Settings → API Keys** (and **Data API** for the URL). Note the project URL, the publishable (or anon) key and the secret (or service_role) key.
4. Push the schema from this folder. The project ref is the part of the project URL before `.supabase.co`.

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

   ```bash
   npx supabase db push
   ```

5. Check it worked: in **Table Editor** you should see `sightings`, `confirmations` and `flags`, and in **Storage** a `sighting-photos` bucket.

Do not run `npm run seed` against the hosted project. It refuses unless you pass `--yes-remote`, because the sample sightings would show on the live map.

Recommended before launch: in **Authentication → Rate Limits** keep the anonymous sign-in limit low (the default is 30 per hour per IP), and consider turning on CAPTCHA under **Authentication → Attack Protection**. A new anonymous identity is the only way around the per-device limits.

## Deploy to Vercel

1. Push this repository to GitHub.
2. At https://vercel.com choose **Add New → Project** and import the repository.
3. Set **Root Directory** to `koala-spotter`. The framework preset should detect Next.js.
4. Add the four environment variables from the table above, using the hosted Supabase values.
5. Deploy. Then open the site on a phone, send one real report and check it in `/admin`.

The repository root also contains an unrelated single-page app (`index.html`). Setting the root directory keeps Vercel away from it.

## Before launch

- **Rescue contacts.** The numbers in `app/injured/page.tsx` were supplied by the site owner. Re-check them now and then.
- **Map tiles.** The app uses the public OpenStreetMap tile server, which is fine for light use but has a usage policy and no uptime guarantee. If the app gets popular, switch `TILE_URL` in `lib/leaflet.ts` to a tile provider.
- **Old photos.** After 48 hours a sighting leaves the map, but its photo file stays in the public bucket and is reachable by anyone who kept the link. The photo has no metadata in it.

## Tested, and not tested

Tested in Chromium at phone size (Pixel 7 emulation) against the production build and a local Supabase stack:

- Map, clustering, age colours, time filters, list sorted by distance, "you are here" dot
- Report with a GPS-tagged JPEG, a GPS-tagged HEIC, a photo with no EXIF, and a photo with GPS off the island
- Photos older than 48 hours or dated in the future are refused
- Location permission denied: list falls back to newest first, report requires a hand-placed pin, a pin off the island is refused
- Stored photos contain no EXIF
- Votes, changing a vote, flags, auto-hide at three flags, deleting your own report
- A sighting older than 48 hours is in the database but is not returned to the map
- Direct table writes, uploads into another device's folder and the rate limits are all refused by the database
- Offline: the app reloads with no network, a report is queued, survives a reload, and sends on reconnect
- Admin: wrong password, sign in, hide, unhide, delete, sign out, and the API refusing requests without the cookie

Not tested:

- **Real map tiles.** The OpenStreetMap tile server was blocked in the build environment, so the map was tested with blank stand-in tiles. Markers and controls are verified; the map imagery is not.
- **Seed coordinates.** The sample sightings use approximate coordinates and were never checked against a real map. Some may sit off the track or in the water.
- **Real phones.** Nothing was run on iOS Safari or a physical Android phone. The camera button, HEIC photos from a real iPhone, home-screen install and GPS accuracy all need a check on a device.
- **Hosted Supabase and Vercel.** The setup and deploy steps above were written from the documentation and not run. Dashboard menu names may have moved.
