import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import client from "@/api/client";
import Logo from "@/components/Logo.jsx";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export default function ClassCode() {
  const [data, setData] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [error, setError] = useState("");
  const pollTimeoutRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await client.get("/me/class-code");
        if (cancelled) return;
        setData(res.data);
        setSecondsLeft(res.data.seconds_remaining);
        setError("");
        const delayMs = Math.max((res.data.seconds_remaining ?? 2) * 1000, 500);
        pollTimeoutRef.current = setTimeout(poll, delayMs);
      } catch {
        if (cancelled) return;
        setError("Could not reach the server.");
        pollTimeoutRef.current = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const interval = data?.interval || 7;
  const progress = secondsLeft == null ? 1 : Math.max(0, Math.min(1, secondsLeft / interval));
  const isExpiringSoon = secondsLeft != null && secondsLeft <= 2;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary/10 via-background to-background px-6 text-center">
      <Link
        to="/"
        className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <ThemeToggle className="absolute right-4 top-4" />

      <div className="rounded-3xl border bg-white px-8 py-5 shadow-lg">
        <Logo className="h-16 w-auto" />
      </div>
      <p className="mt-6 text-lg font-medium">Class check-in code</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Keep this screen visible to your students until everyone has checked in.
      </p>

      {error ? (
        <p className="mt-8 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-danger">{error}</p>
      ) : (
        <>
          <p
            className={cn(
              "mt-8 text-8xl font-bold tabular-nums tracking-[0.15em] transition-colors sm:text-9xl",
              isExpiringSoon ? "text-warning" : "text-primary"
            )}
          >
            {data?.code || "----"}
          </p>

          <div className="mt-8 w-full max-w-xs">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-1000 ease-linear",
                  isExpiringSoon ? "bg-warning" : "bg-primary"
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Changes every {interval} seconds</p>
          </div>
        </>
      )}
    </div>
  );
}
