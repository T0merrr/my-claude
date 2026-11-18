"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseUrl } from "@/lib/supabase-url";

interface AdminSighting {
  id: string;
  created_at: string;
  captured_at: string;
  lat: number;
  lng: number;
  location_source: string;
  time_source: string;
  verified: boolean;
  photo_path: string;
  thumbnail_path: string;
  koala_count: number | null;
  has_joey: boolean | null;
  activity: string | null;
  track_name: string | null;
  hint: string | null;
  camera_model: string | null;
  device_id: string | null;
  hidden: boolean;
  hidden_reason: string | null;
  reviewed_at: string | null;
  still_here_count: number;
  not_found_count: number;
  flag_count: number;
  flag_reasons: string[];
}

type Tab = "attention" | "live" | "hidden" | "expired";

const TAB_LABEL: Record<Tab, string> = {
  attention: "Needs attention",
  live: "On the map",
  hidden: "Hidden",
  expired: "Older than 48 h",
};

const photo = (path: string) =>
  `${supabaseUrl()}/storage/v1/object/public/sighting-photos/${path}`;

const isExpired = (s: AdminSighting) => Date.now() - new Date(s.captured_at).getTime() > 48 * 3600_000;

function inTab(s: AdminSighting, tab: Tab): boolean {
  switch (tab) {
    case "attention":
      return s.flag_count > 0 && !s.reviewed_at;
    case "live":
      return !s.hidden && !isExpired(s);
    case "hidden":
      return s.hidden;
    case "expired":
      return isExpired(s);
  }
}

const HOUR = 3600_000;

/** Usage figures worked out from the sightings list. */
function summarise(sightings: AdminSighting[], now: number) {
  const since = (h: number) => sightings.filter((s) => now - new Date(s.created_at).getTime() < h * HOUR);
  const sum = (key: "still_here_count" | "not_found_count" | "flag_count") =>
    sightings.reduce((n, s) => n + s[key], 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now - i * 24 * HOUR);
    const label = day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    const count = sightings.filter((s) => new Date(s.created_at).toDateString() === day.toDateString()).length;
    return { label, count };
  }).reverse();
  return {
    reports24h: since(24).length,
    reports7d: since(24 * 7).length,
    reportsAll: sightings.length,
    reporters: new Set(sightings.map((s) => s.device_id).filter(Boolean)).size,
    stillHere: sum("still_here_count"),
    notFound: sum("not_found_count"),
    flags: sum("flag_count"),
    verified: sightings.filter((s) => s.verified).length,
    days,
  };
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border-2 border-line p-3">
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums">{value}</p>
      {note && <p className="text-xs">{note}</p>}
    </div>
  );
}

export default function AdminPanel() {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sightings, setSightings] = useState<AdminSighting[]>([]);
  const [tab, setTab] = useState<Tab>("attention");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/sightings", { cache: "no-store" });
    if (res.status === 401) {
      setState("login");
      return;
    }
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Couldn't load sightings.");
      setState("ready");
      return;
    }
    setSightings(body.sightings);
    setLoadedAt(Date.now());
    setError(null);
    setState("ready");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Couldn't sign in.");
      return;
    }
    setPassword("");
    setState("loading");
    await load();
  }

  async function act(id: string, init: RequestInit) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/sightings/${id}`, { ...init, headers: { "Content-Type": "application/json" } });
      if (!res.ok) setError((await res.json()).error ?? "That didn't work.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (state === "loading") return <main className="p-6 text-lg">Loading…</main>;

  if (state === "login") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-extrabold">Admin</h1>
        <form onSubmit={login} className="mt-4 space-y-3">
          <label className="block text-base font-semibold">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 block h-12 w-full rounded-xl border-2 border-ink px-3"
            />
          </label>
          {error && (
            <p role="alert" className="font-semibold text-red-800">
              {error}
            </p>
          )}
          <button className="h-12 w-full rounded-xl bg-brand text-lg font-bold text-white">Sign in</button>
        </form>
      </main>
    );
  }

  const shown = sightings.filter((s) => inTab(s, tab));
  const stats = summarise(sightings, loadedAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Sightings admin</h1>
        <button
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" });
            setSightings([]);
            setState("login");
          }}
          className="h-11 rounded-xl border-2 border-ink px-4 font-bold"
        >
          Sign out
        </button>
      </div>

      <section aria-labelledby="usage-title" className="mt-5">
        <h2 id="usage-title" className="text-lg font-extrabold">
          Usage
        </h2>
        <p className="text-sm">Counted from the database, so ad blockers don&apos;t affect it. Includes hidden and expired posts.</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Reports, last 24 h" value={stats.reports24h} />
          <Stat label="Reports, last 7 days" value={stats.reports7d} />
          <Stat label="Reports, all time" value={stats.reportsAll} note={`${stats.verified} verified`} />
          <Stat label="Phones that reported" value={stats.reporters} />
          <Stat label="“Still here” votes" value={stats.stillHere} />
          <Stat label="“Couldn’t find it” votes" value={stats.notFound} />
          <Stat label="Flags" value={stats.flags} />
        </div>
        <div className="mt-3 rounded-xl border-2 border-line p-3">
          <p className="text-sm font-semibold">Reports per day</p>
          <ul className="mt-1 grid grid-cols-7 gap-1 text-center">
            {stats.days.map((d) => (
              <li key={d.label}>
                <p className="text-xl font-extrabold tabular-nums">{d.count}</p>
                <p className="text-xs">{d.label}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filter">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`h-11 rounded-xl px-3 font-bold ${tab === t ? "bg-ink text-white" : "border-2 border-line"}`}
          >
            {TAB_LABEL[t]} ({sightings.filter((s) => inTab(s, t)).length})
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 font-semibold text-red-800">
          {error}
        </p>
      )}

      {shown.length === 0 && <p className="mt-6 text-lg">Nothing here.</p>}

      <ul className="mt-4 space-y-3">
        {shown.map((s) => (
          <li key={s.id} data-testid="admin-row" className="flex gap-3 rounded-xl border-2 border-line p-3">
            <a href={photo(s.photo_path)} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={photo(s.thumbnail_path)} alt="Sighting photo" className="h-28 w-28 rounded-lg bg-sand object-cover" />
            </a>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-base font-bold">
                {new Date(s.captured_at).toLocaleString()} {s.track_name ? `· ${s.track_name}` : ""}
              </p>
              <p className="break-words">{s.hint ?? "No hint"}</p>
              <p className="mt-1">
                {s.lat.toFixed(5)}, {s.lng.toFixed(5)} · location: {s.location_source} · time: {s.time_source}
                {s.verified ? " · verified" : ""}
                {s.camera_model ? ` · ${s.camera_model}` : ""}
              </p>
              <p>
                {s.still_here_count} found it · {s.not_found_count} couldn&apos;t · device {s.device_id?.slice(0, 8) ?? "none"}
              </p>
              <p className="mt-1 font-semibold">
                {s.hidden ? `Hidden (${s.hidden_reason === "flags" ? "auto-hidden by flags" : "by admin"})` : isExpired(s) ? "Off the map (older than 48 h)" : "On the map"}
                {s.flag_count > 0 && (
                  <span className="text-red-800">
                    {" "}
                    · {s.flag_count} flag{s.flag_count > 1 ? "s" : ""}: {s.flag_reasons.join(", ").replaceAll("_", " ")}
                  </span>
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  disabled={busyId === s.id}
                  onClick={() => act(s.id, { method: "PATCH", body: JSON.stringify({ hidden: !s.hidden }) })}
                  className="h-11 rounded-xl border-2 border-ink px-4 font-bold disabled:opacity-50"
                >
                  {s.hidden ? "Unhide" : "Hide"}
                </button>
                {!s.hidden && s.flag_count > 0 && !s.reviewed_at && (
                  <button
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, { method: "PATCH", body: JSON.stringify({ hidden: false }) })}
                    className="h-11 rounded-xl border-2 border-ink px-4 font-bold disabled:opacity-50"
                  >
                    Keep (dismiss flags)
                  </button>
                )}
                <button
                  disabled={busyId === s.id}
                  onClick={() => {
                    if (window.confirm("Delete this post and its photos for good?")) void act(s.id, { method: "DELETE" });
                  }}
                  className="h-11 rounded-xl bg-red-700 px-4 font-bold text-white disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
