"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-renders the server page every `seconds` while the tab is visible (no reload, no scroll jump). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && Date.now() - at >= seconds * 1000) { router.refresh(); setAt(Date.now()); }
    }, 1000);
    return () => clearInterval(t);
  }, [router, seconds, at]);
  const ago = Math.max(0, Math.round((now - at) / 1000));
  return (
    <span className="live on small" title={`This page refreshes itself every ${seconds} seconds`}>
      ● live · updated {ago < 5 ? "just now" : `${ago} s ago`}{" "}
      <button className="linklike small" onClick={() => { router.refresh(); setAt(Date.now()); }}>refresh</button>
    </span>
  );
}
