import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarOff, Loader2 } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import Logo from "@/components/Logo.jsx";
import { ThemeToggle } from "@/components/theme-toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatTime } from "@/lib/utils";

// Rotating code for one class session. Each session has its own code, so it
// only works for this batch.
function RotatingCode({ timetableId }) {
  const [data, setData] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [error, setError] = useState("");
  const pollTimeoutRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);

    async function poll() {
      try {
        const res = await client.get("/me/class-code", { params: { timetable_id: timetableId } });
        if (cancelled) return;
        setData(res.data);
        setSecondsLeft(res.data.seconds_remaining);
        setError("");
        const delayMs = Math.max((res.data.seconds_remaining ?? 2) * 1000, 500);
        pollTimeoutRef.current = setTimeout(poll, delayMs);
      } catch (err) {
        if (cancelled) return;
        setError(apiErrorMessage(err, "Could not reach the server."));
        pollTimeoutRef.current = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(pollTimeoutRef.current);
    };
  }, [timetableId]);

  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const interval = data?.interval || 20;
  const progress = secondsLeft == null ? 1 : Math.max(0, Math.min(1, secondsLeft / interval));
  const isExpiringSoon = secondsLeft != null && secondsLeft <= 3;

  if (error) {
    return <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-danger">{error}</p>;
  }

  return (
    <div className="flex flex-col items-center">
      <p className="text-sm font-medium text-muted-foreground">Class code</p>
      <p
        className={cn(
          "mt-2 text-6xl font-bold tabular-nums tracking-[0.12em] transition-colors sm:text-7xl lg:text-8xl",
          isExpiringSoon ? "text-warning" : "text-primary"
        )}
      >
        {data?.code || "------"}
      </p>
      <div className="mt-6 w-full max-w-xs">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all duration-1000 ease-linear", isExpiringSoon ? "bg-warning" : "bg-primary")}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">Changes every {interval} seconds</p>
      </div>
    </div>
  );
}

function SessionQr({ timetableId }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl = "";
    setUrl("");
    setError("");
    client
      .get("/me/class-qr.png", { params: { timetable_id: timetableId }, responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => setError("Could not load the QR code."));
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [timetableId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!url) return <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />;
  return <img src={url} alt="Class check-in QR code" className="w-full max-w-[22rem] rounded-xl shadow-lg" />;
}

export default function ClassCode() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [classes, setClasses] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get("/me/classes-today")
      .then((res) => {
        setClasses(res.data.classes);
        // ?timetable_id= (from Admin > Student overview) opens that session directly.
        const requested = Number(params.get("timetable_id"));
        const match = res.data.classes.find((c) => c.id === requested);
        setSelectedId(match ? match.id : res.data.default_timetable_id);
      })
      .catch((err) => setError(apiErrorMessage(err, "Could not load today's classes.")));
  }, []);

  const selected = classes?.find((c) => c.id === selectedId);

  return (
    <div className="relative flex min-h-screen flex-col items-center bg-gradient-to-b from-primary/10 via-background to-background px-6 pb-10 pt-16 text-center">
      <Link
        to="/"
        className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <ThemeToggle className="absolute right-4 top-4" />

      <div className="rounded-3xl border bg-white px-6 py-3 shadow-lg">
        <Logo className="h-12 w-auto" />
      </div>

      {error && <p className="mt-8 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-danger">{error}</p>}

      {!error && classes === null && <Loader2 className="mt-16 h-8 w-8 animate-spin text-muted-foreground" />}

      {classes?.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
          <CalendarOff className="h-10 w-10" />
          <p className="font-medium text-foreground">{isAdmin ? "No classes are scheduled today" : "You have no classes scheduled today"}</p>
          <p className="text-sm">The check-in QR code and class code appear here on days {isAdmin ? "classes run" : "you teach"}.</p>
        </div>
      )}

      {selected && (
        <>
          <div className="mt-6 w-full max-w-md">
            {classes.length > 1 ? (
              <Select value={String(selectedId)} onValueChange={(v) => setSelectedId(Number(v))}>
                <SelectTrigger className="h-auto py-2 text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.batch} · {c.course_name} · {formatTime(c.scheduled_start)}
                      {isAdmin && c.lecturer_name ? ` · ${c.lecturer_name}` : ""}
                      {c.ended ? " (ended)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-lg font-semibold">
                {selected.batch} · {selected.course_name}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Keep this screen visible until everyone has checked in. Students scan the QR code, sign in, then type the class code.
              Only students of {selected.batch} can use them.
            </p>
          </div>

          <div className="mt-8 grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
            <div className="flex justify-center">
              <SessionQr timetableId={selected.id} />
            </div>
            <RotatingCode timetableId={selected.id} />
          </div>
        </>
      )}
    </div>
  );
}
