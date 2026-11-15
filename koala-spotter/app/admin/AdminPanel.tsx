"use client";

import { useCallback, useEffect, useState } from "react";

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
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/sighting-photos/${path}`;

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

export default function AdminPanel() {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sightings, setSightings] = useState<AdminSighting[]>([]);
  const [tab, setTab] = useState<Tab>("attention");
  const [busyId, setBusyId] = useState<string | null>(null);

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

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter">
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
