"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Information banner (no consent needed: only strictly necessary cookies). Shown once; the choice stays in this browser. */
export function CookieNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem("ns-cookie-notice") !== "1"); } catch { setShow(false); }
  }, []);
  if (!show) return null;
  return (
    <div className="cookie-notice" role="region" aria-label="Cookies">
      <span>nosorry uses only the cookies it needs to keep you signed in — no advertising, analytics or tracking. Your IP address
        is logged for security (12 months). <Link href="/cookies">Cookie policy</Link> · <Link href="/privacy">Privacy</Link></span>
      <button className="btn small" onClick={() => { try { localStorage.setItem("ns-cookie-notice", "1"); } catch { /* private mode */ } setShow(false); }}>OK</button>
    </div>
  );
}
