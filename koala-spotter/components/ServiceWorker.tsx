"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (production builds only) and hands it the
 * files this page has already loaded, so the app opens with no signal.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const sendLoadedFiles = () => {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && u.includes("/_next/static/"));
      navigator.serviceWorker.ready.then((reg) => {
        reg.active?.postMessage({ type: "CACHE_URLS", urls });
      });
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then(() => {
        if (document.readyState === "complete") sendLoadedFiles();
        else window.addEventListener("load", sendLoadedFiles, { once: true });
        // Chunks that load later (the map, for example).
        setTimeout(sendLoadedFiles, 5000);
      })
      .catch(() => {});
  }, []);

  return null;
}
