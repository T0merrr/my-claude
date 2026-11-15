"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ListView from "./ListView";
import MapView from "./MapView";
import ReportSheet from "./ReportSheet";
import SightingCard from "./SightingCard";
import WelfareNotice from "./WelfareNotice";
import { fetchSightings, flushQueue, loadCachedSightings } from "@/lib/api";
import { listQueue, removeFromQueue, type QueuedReport } from "@/lib/queue";
import { isConfigured } from "@/lib/supabase";
import { FILTER_LABEL, timeAgo, withinFilter } from "@/lib/time";
import type { LatLng, Sighting, TimeFilter } from "@/lib/types";

const WELFARE_KEY = "maggie-koala-welfare-seen";
const FILTERS: TimeFilter[] = ["3h", "today", "48h"];

type LocState = "idle" | "asking" | "on" | "denied" | "unavailable";

export default function App() {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Timestamp of the data on screen when it came from this phone's cache. */
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [filter, setFilter] = useState<TimeFilter>("today");
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [showWelfare, setShowWelfare] = useState(false);
  const [userPos, setUserPos] = useState<(LatLng & { accuracy?: number }) | null>(null);
  const [locState, setLocState] = useState<LocState>("idle");
  const [recenterToken, setRecenterToken] = useState(0);
  const [queue, setQueue] = useState<QueuedReport[]>([]);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  // Set on mount: the page shell is prerendered, so it can't read the clock.
  const [now, setNow] = useState(0);
  const watchId = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const refresh = useCallback(async () => {
    if (!isConfigured) {
      setLoaded(true);
      return;
    }
    try {
      setSightings(await fetchSightings());
      setStaleSince(null);
    } catch {
      const cached = loadCachedSightings();
      if (cached) {
        setSightings(cached.sightings);
        setStaleSince(cached.at);
      }
    } finally {
      setLoaded(true);
      setNow(Date.now());
    }
  }, []);

  const syncQueue = useCallback(async () => {
    const pending = await listQueue();
    setQueue(pending);
    if (!pending.some((r) => !r.failed)) return;
    setSending(true);
    try {
      const result = await flushQueue();
      setQueue(await listQueue());
      if (result.sent > 0) {
        showToast(result.sent === 1 ? "Your report is on the map. Thank you!" : `${result.sent} reports sent. Thank you!`);
        await refresh();
      }
    } finally {
      setSending(false);
    }
  }, [refresh, showToast]);

  // First load, then keep things fresh.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setNow(Date.now());
    setOnline(navigator.onLine);
    if (!localStorage.getItem(WELFARE_KEY)) setShowWelfare(true);
    void refresh();
    void syncQueue();
    /* eslint-enable react-hooks/set-state-in-effect */

    const goOnline = () => {
      setOnline(true);
      void refresh();
      void syncQueue();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        void syncQueue();
      }
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const poll = setInterval(() => void refresh(), 120_000);
    // navigator.onLine is unreliable on a weak signal, so also retry on a timer.
    const retry = setInterval(() => void syncQueue(), 30_000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
      clearInterval(poll);
      clearInterval(retry);
    };
  }, [refresh, syncQueue]);

  const startWatching = useCallback(
    (recenter: boolean) => {
      if (!("geolocation" in navigator)) {
        setLocState("unavailable");
        showToast("This browser can't share your location.");
        return;
      }
      if (watchId.current !== null) {
        if (recenter) setRecenterToken((t) => t + 1);
        return;
      }
      setLocState("asking");
      let first = true;
      watchId.current = navigator.geolocation.watchPosition(
        (p) => {
          setUserPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
          setLocState("on");
          if (first && recenter) setRecenterToken((t) => t + 1);
          first = false;
        },
        (err) => {
          if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          setUserPos(null);
          if (err.code === err.PERMISSION_DENIED) {
            setLocState("denied");
            showToast("Location is off for this site. The map still works, and the list shows newest first.");
          } else {
            setLocState("unavailable");
            showToast("Couldn't find your location. Try again outdoors.");
          }
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
      );
    },
    [showToast],
  );

  // If location was already allowed on an earlier visit, show the dot
  // straight away. Otherwise wait until the visitor asks for it.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") startWatching(false);
        else if (status.state === "denied") setLocState("denied");
      })
      .catch(() => {});
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [startWatching]);

  const visible = useMemo(() => sightings.filter((s) => withinFilter(s, filter, now)), [sightings, filter, now]);
  const selected = sightings.find((s) => s.id === selectedId) ?? null;
  const waiting = queue.filter((r) => !r.failed);
  const failed = queue.filter((r) => r.failed);
  const widerFilter = FILTERS[FILTERS.indexOf(filter) + 1];
  const widerCount = widerFilter ? sightings.filter((s) => withinFilter(s, widerFilter, now)).length : 0;

  return (
    <main className="fixed inset-0 overflow-hidden">
      <MapView
        sightings={visible}
        selectedId={selectedId}
        onSelect={setSelectedId}
        userPos={userPos}
        recenterToken={recenterToken}
        now={now}
      />

      {view === "list" && (
        <ListView
          sightings={visible}
          userPos={userPos}
          locationOff={locState === "denied" || locState === "unavailable"}
          now={now}
          onSelect={setSelectedId}
          onFindMe={() => startWatching(false)}
        />
      )}

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 space-y-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto rounded-2xl border-2 border-ink bg-paper p-2 shadow-lg">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <h1 className="text-lg font-extrabold leading-tight">Maggie Koala Spotter</h1>
            <Link href="/injured" className="shrink-0 rounded-full border-2 border-red-700 px-3 py-1.5 text-sm font-bold text-red-800">
              Injured koala?
            </Link>
          </div>
          <div className="flex gap-1" role="group" aria-label="Show sightings from">
            {FILTERS.map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setSelectedId(null);
                }}
                className={`h-12 flex-1 rounded-xl text-base font-bold ${filter === f ? "bg-ink text-white" : "border-2 border-line"}`}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        {(waiting.length > 0 || failed.length > 0) && (
          <div role="status" className="pointer-events-auto rounded-2xl border-2 border-amber-700 bg-amber-100 p-3 text-amber-950 shadow-lg">
            {waiting.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-base font-bold leading-snug">
                  {sending
                    ? `Sending ${waiting.length} report${waiting.length > 1 ? "s" : ""}…`
                    : `${waiting.length} report${waiting.length > 1 ? "s" : ""} saved on this phone. ${
                        online ? "Will retry shortly." : "Will send when you're back in range."
                      }`}
                </p>
                {!sending && (
                  <button onClick={() => void syncQueue()} className="h-12 shrink-0 rounded-xl border-2 border-amber-950 px-3 text-base font-bold">
                    Send now
                  </button>
                )}
              </div>
            )}
            {failed.map((r) => (
              <div key={r.id} className="mt-1 flex items-center justify-between gap-2">
                <p className="text-base font-semibold leading-snug">A report couldn&apos;t be sent: {r.failed}</p>
                <button
                  onClick={async () => {
                    await removeFromQueue(r.id);
                    setQueue(await listQueue());
                  }}
                  className="h-12 shrink-0 rounded-xl border-2 border-amber-950 px-3 text-base font-bold"
                >
                  Discard
                </button>
              </div>
            ))}
          </div>
        )}

        {(!online || staleSince !== null) && loaded && (
          <p role="status" className="pointer-events-auto rounded-2xl bg-ink px-3 py-2 text-base font-semibold text-white shadow-lg">
            No connection. {staleSince !== null ? `Showing sightings saved ${timeAgo(new Date(staleSince).toISOString(), now)}.` : "Sightings may be out of date."}
          </p>
        )}

        {!isConfigured && (
          <p role="alert" className="pointer-events-auto rounded-2xl bg-red-700 px-3 py-2 text-base font-semibold text-white">
            The app isn&apos;t connected to its database yet. See the README for setup.
          </p>
        )}
      </div>

      {/* Empty state */}
      {loaded && isConfigured && visible.length === 0 && !selected && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center px-6">
          <div className="pointer-events-auto max-w-sm rounded-2xl border-2 border-ink bg-paper p-4 text-center shadow-lg">
            <p className="text-lg font-bold">
              No sightings {filter === "3h" ? "in the last 3 hours" : filter === "today" ? "in the last 24 hours" : "in the last 48 hours"}.
            </p>
            {widerFilter && widerCount > 0 ? (
              <button onClick={() => setFilter(widerFilter)} className="mt-3 h-12 w-full rounded-xl bg-brand text-base font-bold text-white">
                Show {widerCount} from {widerFilter === "today" ? "the last 24 hours" : "the last 48 hours"}
              </button>
            ) : (
              <p className="mt-1 text-base">Spot one? Be the first to report it.</p>
            )}
          </div>
        </div>
      )}

      {/* Map controls */}
      {view === "map" && !selected && (
        <div className="absolute right-3 bottom-32 z-20 flex flex-col items-end gap-2">
          <div className="rounded-xl border-2 border-ink bg-paper px-2.5 py-1.5 text-sm font-semibold shadow" aria-label="Pin colours">
            <span className="mr-2 inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-full bg-fresh" />under 3 h</span>
            <span className="mr-2 inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-full bg-today" />today</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-full bg-older" />1–2 days</span>
          </div>
          <button
            onClick={() => startWatching(true)}
            className="flex h-14 items-center gap-2 rounded-full border-2 border-ink bg-paper px-4 text-base font-bold shadow-lg"
            aria-label="Show where I am on the map"
          >
            <span className="inline-block h-4 w-4 rounded-full border-2 border-white bg-blue-700 ring-2 ring-blue-700" aria-hidden />
            {locState === "asking" ? "Finding you…" : "Find me"}
          </button>
        </div>
      )}

      {selected && (
        <SightingCard
          key={selected.id}
          sighting={selected}
          userPos={userPos}
          now={now}
          onClose={() => setSelectedId(null)}
          onChanged={() => void refresh()}
          onToast={showToast}
        />
      )}

      {/* Bottom bar */}
      {!selected && (
        <nav className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" aria-label="Main">
          <button
            aria-pressed={view === "map"}
            onClick={() => setView("map")}
            className={`h-14 flex-1 rounded-2xl border-2 border-ink text-lg font-bold shadow-lg ${view === "map" ? "bg-ink text-white" : "bg-paper"}`}
          >
            Map
          </button>
          <button
            onClick={() => setReportOpen(true)}
            className="h-[4.5rem] flex-[1.7] rounded-2xl border-2 border-white bg-brand px-1 text-lg font-extrabold whitespace-nowrap text-white shadow-xl"
            aria-label="Report a koala"
          >
            + Report koala
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            className={`h-14 flex-1 rounded-2xl border-2 border-ink text-lg font-bold shadow-lg ${view === "list" ? "bg-ink text-white" : "bg-paper"}`}
          >
            List
          </button>
        </nav>
      )}

      {reportOpen && (
        <ReportSheet
          onClose={() => setReportOpen(false)}
          onQueued={() => {
            setReportOpen(false);
            showToast(navigator.onLine ? "Sending your report…" : "Saved on this phone. It will send when you're back in range.");
            void syncQueue();
          }}
        />
      )}

      {showWelfare && (
        <WelfareNotice
          onDismiss={() => {
            localStorage.setItem(WELFARE_KEY, "1");
            setShowWelfare(false);
          }}
        />
      )}

      {toast && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-1/2 z-[60] flex justify-center px-4">
          <p className="rounded-2xl bg-ink px-4 py-3 text-center text-base font-semibold text-white shadow-xl">{toast}</p>
        </div>
      )}
    </main>
  );
}
