"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the page every few seconds while the submission is being checked. */
export default function AutoRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return <p className="muted small sans">Checking… this page updates by itself.</p>;
}
