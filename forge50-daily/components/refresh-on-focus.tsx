"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// A home screen web app has no reload button or pull-to-refresh, and iOS
// keeps it suspended in the background for days. Re-fetch the page when it
// comes back to the foreground after a few minutes.
const STALE_MS = 5 * 60 * 1000;

export function RefreshOnFocus() {
  const router = useRouter();
  const lastLoad = useRef(0);

  useEffect(() => {
    lastLoad.current = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoad.current < STALE_MS) return;
      lastLoad.current = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return null;
}
