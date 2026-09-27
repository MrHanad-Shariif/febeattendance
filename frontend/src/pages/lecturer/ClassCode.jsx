import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarOff, CheckCircle2, Loader2, Monitor, PenLine, Play, RefreshCw, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import Logo from "@/components/Logo.jsx";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatTime } from "@/lib/utils";

const MODE_KEY = "classCheckinMode";

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "board" ? "board" : "qr";
  } catch {
    return "qr";
  }
}

function saveMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode / blocked storage: the choice just isn't remembered.
  }
}

function mmss(total) {
  const s = Math.max(0, total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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

// Board mode: the lecturer starts check-in, writes the short code on the
// board, and watches the live count. Students type the code instead of
// scanning the QR code; location and face checks are unchanged.
function BoardPanel({ timetableId }) {
  const [state, setState] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  function apply(data) {
    setState(data);
    setSecondsLeft(data.session?.open ? data.session.seconds_left : 0);
  }

  useEffect(() => {
    let cancelled = false;
    let timer;
    setState(null);
    setError("");
    async function poll() {
      try {
        const res = await client.get("/me/board-session", { params: { timetable_id: timetableId } });
        if (!cancelled) {
          apply(res.data);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err, "Could not reach the server."));
      }
      if (!cancelled) timer = setTimeout(poll, 4000);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [timetableId]);

  useEffect(() => {
    const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  async function act(path, success) {
    setBusy(true);
    try {
      const res = await client.post(`/me/board-session${path}`, { timetable_id: timetableId });
      apply(res.data);
      setError("");
      if (success) toast.success(success);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return error ? (
      <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-danger">{error}</p>
    ) : (
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
    );
  }

  const { session, counts } = state;
  const open = session?.open && secondsLeft > 0;
  const countLine = (
    <p className="flex items-center justify-center gap-2 text-lg font-semibold text-success">
      <CheckCircle2 className="h-5 w-5" />
      {counts.checked_in} checked in
      {counts.enrolled > 0 && <span className="text-sm font-normal text-muted-foreground">of {counts.enrolled} in the batch</span>}
    </p>
  );

  if (!open) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5">
        {session ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Board check-in closed at {formatTime(session.closed_at || session.closes_at)}
              {session.closed_by_name ? ` by ${session.closed_by_name}` : " automatically"}.
            </p>
            {countLine}
            {counts.qr > 0 && <p className="text-xs">{counts.board} by board code · {counts.qr} by QR</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Teaching without a screen? Start board check-in, write the code on the board, and students type it in the app instead of scanning a QR code.
            Location and face checks stay the same.
          </p>
        )}
        <Button size="lg" className="h-14 w-full text-base" disabled={busy} onClick={() => act("", "Board check-in started")}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />} {session ? "Start board check-in again" : "Start board check-in"}
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5">
      <p className="text-sm font-medium text-muted-foreground">Board code — write this on the board</p>
      <p className="text-7xl font-bold tabular-nums tracking-[0.3em] text-primary sm:text-8xl">{session.code}</p>
      <p className={cn("flex items-center gap-2 text-sm", secondsLeft <= 60 ? "text-warning" : "text-muted-foreground")}>
        <Timer className="h-4 w-4" /> Open for {mmss(secondsLeft)} more (closes {formatTime(session.closes_at)})
      </p>
      {countLine}
      <p className="-mt-3 text-xs text-muted-foreground">
        Compare with the number of people in the room. A big gap means someone is checking in from outside.
      </p>
      <div className="grid w-full grid-cols-2 gap-3">
        <Button variant="outline" size="lg" disabled={busy} onClick={() => act("/new-code", "New code: the old one no longer works")}>
          <RefreshCw /> New code
        </Button>
        <Button variant="destructive" size="lg" disabled={busy} onClick={() => setConfirmClose(true)}>
          <Square /> Close check-in
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Close board check-in?"
        description="Students still checking in will be stopped. You can record late arrivals from the student list with a remark."
        confirmLabel="Close check-in"
        onConfirm={() => act("/close", "Board check-in closed")}
      />
    </div>
  );
}

function ModeSwitch({ mode, onChange }) {
  const options = [
    { value: "qr", label: "Screen (QR code)", icon: Monitor },
    { value: "board", label: "Board code", icon: PenLine },
  ];
  return (
    <div role="tablist" className="inline-flex rounded-xl border bg-muted/50 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={mode === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mode === o.value ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <o.icon className="h-4 w-4" /> {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ClassCode() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const seesAll = can("class_checkin:view");
  const [classes, setClasses] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(() => (params.get("mode") === "board" ? "board" : readMode()));

  function changeMode(next) {
    setMode(next);
    saveMode(next);
  }

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
          <p className="font-medium text-foreground">{seesAll ? "No classes are scheduled today" : "You have no classes scheduled today"}</p>
          <p className="text-sm">The check-in QR code and class code appear here on days {seesAll ? "classes run" : "you teach"}.</p>
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
                      {!c.mine && c.lecturer_name ? ` · ${c.lecturer_name}` : ""}
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
            <div className="mt-4 flex justify-center">
              <ModeSwitch mode={mode} onChange={changeMode} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {mode === "qr"
                ? `Keep this screen visible until everyone has checked in. Students scan the QR code, sign in, then type the class code. Only students of ${selected.batch} can use them.`
                : `Students tap "Check in to current class" in the app and type the board code. Only students of ${selected.batch} can use it.`}
            </p>
          </div>

          {mode === "qr" ? (
            <div className="mt-8 grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
              <div className="flex justify-center">
                <SessionQr timetableId={selected.id} />
              </div>
              <RotatingCode timetableId={selected.id} />
            </div>
          ) : (
            <div className="mt-8 w-full">
              <BoardPanel key={selected.id} timetableId={selected.id} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
