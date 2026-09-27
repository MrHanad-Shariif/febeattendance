import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import client from "@/api/client";
import Logo from "@/components/Logo.jsx";
import { cn } from "@/lib/utils";

// The kiosk is a wall/TV display, so it keeps a fixed dark green look regardless of the app theme.
export default function Kiosk() {
  const [searchParams] = useSearchParams();
  const key = searchParams.get("key") || "";
  const [data, setData] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [error, setError] = useState("");
  const pollTimeoutRef = useRef(null);

  // Poll the server for the current code, only as often as it actually changes.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await client.get("/kiosk/code", { params: { key } });
        if (cancelled) return;
        setData(res.data);
        setSecondsLeft(res.data.seconds_remaining);
        setError("");
        const delayMs = Math.max((res.data.seconds_remaining ?? 5) * 1000, 1000);
        pollTimeoutRef.current = setTimeout(poll, delayMs);
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.status === 403 ? "This kiosk link is not authorized." : "Could not reach the server.");
        pollTimeoutRef.current = setTimeout(poll, 5000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(pollTimeoutRef.current);
    };
  }, [key]);

  // Tick the on-screen countdown every second between polls.
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const interval = data?.interval || 60;
  const progress = secondsLeft == null ? 1 : Math.max(0, Math.min(1, secondsLeft / interval));
  const isExpiringSoon = secondsLeft != null && secondsLeft <= 10;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-900 via-[#0b1f14] to-[#07130c] px-6 text-center text-white">
      <div className="rounded-3xl bg-white px-10 py-6 shadow-2xl">
        <Logo className="h-24 w-auto" />
      </div>

      <p className="mt-6 text-xl text-brand-100">{data?.site_name || "FEBEMS"}</p>
      <p className="mt-1 text-sm uppercase tracking-widest text-brand-300/80">Campus check-in code</p>

      {error ? (
        <p className="mt-8 rounded-lg bg-red-500/20 px-4 py-2 text-red-200">{error}</p>
      ) : (
        <>
          <p
            className={cn(
              "mt-8 text-7xl font-bold tabular-nums tracking-[0.2em] transition-colors sm:text-8xl",
              isExpiringSoon ? "animate-pulse text-amber-400" : "text-white"
            )}
          >
            {data?.code || "------"}
          </p>

          <div className="mt-8 w-full max-w-md">
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-1000 ease-linear",
                  isExpiringSoon ? "bg-amber-400" : "bg-brand-400"
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p className={cn("mt-3 text-sm", isExpiringSoon ? "text-amber-300" : "text-brand-200/80")}>
              {secondsLeft != null ? (
                <>
                  New code in <span className="font-semibold">{secondsLeft}s</span>
                </>
              ) : (
                "Loading..."
              )}
            </p>
          </div>

          <p className="mt-6 max-w-md text-sm text-brand-200/60">
            Read this code and type it into your phone when checking in or out.
          </p>
        </>
      )}
    </div>
  );
}
