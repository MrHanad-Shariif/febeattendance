import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DoorOpen,
  KeyRound,
  Loader2,
  MapPin,
  PenLine,
  QrCode,
  RotateCcw,
  ScanFace,
  ShieldX,
  User,
} from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import FaceCapture, { faceFormData } from "@/components/FaceCapture.jsx";
import StatusBadge from "@/components/StatusBadge.jsx";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatTime } from "@/lib/utils";

const STEPS = [
  { key: "code", label: "Class code", icon: KeyRound },
  { key: "location", label: "Location", icon: MapPin },
  { key: "face", label: "Face scan", icon: ScanFace },
];

// Refusals from /student/checkin/start that end the flow, keyed by the API's `reason`.
const REFUSAL_TITLES = {
  wrong_batch: "This QR code is for another class",
  already_checked_in: "You're already checked in",
  blocked: "Check-in blocked",
  face_locked: "Check-in locked for this class",
  board_locked: "Board check-in locked for this class",
  board_closed: "Board check-in closed",
  no_class: "No class is running right now",
};

// Refusals where starting again can't help.
const FINAL_REASONS = ["already_checked_in", "wrong_batch", "blocked", "face_locked", "face_mismatch", "board_locked"];

function Notice({ tone = "danger", icon: Icon, title, children, action }) {
  const tones = {
    danger: "bg-danger/10 text-danger",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/15 text-success",
  };
  return (
    <Card>
      <CardContent className="space-y-4 p-6 text-center">
        <div className={cn("mx-auto flex h-12 w-12 items-center justify-center rounded-full", tones[tone])}>
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <div className="text-sm text-muted-foreground">{children}</div>
        {action}
      </CardContent>
    </Card>
  );
}

function Stepper({ steps, current }) {
  const active = steps.filter((s) => s.enabled);
  const currentIndex = active.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2">
      {active.map((s, i) => {
        const done = current === "done" || i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs",
                done && "border-success bg-success text-white",
                isCurrent && "border-primary bg-primary text-primary-foreground",
                !done && !isCurrent && "text-muted-foreground"
              )}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
            </span>
            <span className={cn("hidden text-xs sm:inline", isCurrent ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
            {i < active.length - 1 && <span className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Student check-in, opened either by scanning the QR code on the lecturer's
 * screen (/student-checkin?s=<session token>) or from "Check in to current
 * class" when the lecturer wrote a board code (/student-checkin?board=1).
 * Steps: class code (rotating or board) -> location (+ Confirm) -> live face
 * scan -> marked present. Which steps apply comes from the server's settings.
 */
export default function StudentCheckIn() {
  const [params] = useSearchParams();
  const sessionToken = params.get("s");
  const boardMode = !sessionToken && params.get("board") === "1";
  const navigate = useNavigate();
  const location = useLocation();

  const [phase, setPhase] = useState("loading"); // loading | code | location | confirm | face | done | refused
  const [session, setSession] = useState(null);
  const [steps, setSteps] = useState({ code: true, location: true, face: true });
  const [ticket, setTicket] = useState("");
  const [challenge, setChallenge] = useState("left");
  const [refusal, setRefusal] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [distance, setDistance] = useState(null);
  const [record, setRecord] = useState(null);

  function refuse(err, fallbackTitle = "You can't check in right now") {
    const data = err.response?.data || {};
    if (data.reason === "face_not_enrolled") {
      navigate("/enroll-face", { replace: true, state: { from: location.pathname + location.search } });
      return;
    }
    setRefusal({
      reason: data.reason,
      title: REFUSAL_TITLES[data.reason] || fallbackTitle,
      message: apiErrorMessage(err, "Something went wrong. Please scan the QR code again."),
    });
    setPhase("refused");
  }

  function accept(data) {
    setTicket(data.ticket);
    if (data.challenge) setChallenge(data.challenge);
    setError("");
  }

  async function start() {
    setPhase("loading");
    setError("");
    setCode("");
    try {
      const res = await client.post("/student/checkin/start", { s: sessionToken });
      accept(res.data);
      setSession(res.data.session);
      setSteps(res.data.steps);
      setPhase(res.data.steps.code ? "code" : res.data.steps.location ? "location" : "face");
    } catch (err) {
      refuse(err);
    }
  }

  // Board mode: the server works out which class is running now for the
  // student's batch; the board code then stands in for the QR + class code.
  const boardLoad = useRef(0);
  async function startBoard() {
    const run = ++boardLoad.current;
    setPhase("loading");
    setError("");
    setCode("");
    try {
      const res = await client.get("/student/current-class");
      if (run !== boardLoad.current) return; // a newer load superseded this one
      const data = res.data;
      if (!data.session) {
        setRefusal({
          reason: "no_class",
          title: REFUSAL_TITLES.no_class,
          message: "Board check-in works during your class, from 30 minutes before it starts until it ends.",
        });
        setPhase("refused");
        return;
      }
      setSession(data.session);
      if (data.checked_in) {
        setRefusal({ reason: "already_checked_in", title: REFUSAL_TITLES.already_checked_in, message: "You've already checked in for this class." });
        setPhase("refused");
        return;
      }
      setSteps((st) => ({ ...st, code: true }));
      setPhase("board");
      if (!data.board_open) setError("Your lecturer hasn't started board check-in yet. Type the code once it's on the board.");
    } catch (err) {
      refuse(err);
    }
  }

  const restart = boardMode ? startBoard : start;

  useEffect(() => {
    if (sessionToken) start();
    else if (boardMode) startBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, boardMode]);

  async function submitBoard(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await client.post("/student/checkin/board", { timetable_id: session.timetable_id, code: code.trim() });
      accept(res.data);
      setSession(res.data.session);
      setSteps(res.data.steps);
      setPhase(res.data.steps.location ? "location" : "confirm");
    } catch (err) {
      const reason = err.response?.data?.reason;
      setCode("");
      if (reason === "board_wrong_code" || reason === "board_not_open") {
        setError(apiErrorMessage(err));
      } else {
        stepFailed(err, "Incorrect code. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  // A step failed because the ticket expired or the class state changed:
  // the whole flow must restart, so surface it as a refusal with "Start again".
  function stepFailed(err, fallback) {
    const status = err.response?.status;
    if (status === 400 || status === 404 || status === 409 || status === 429) {
      refuse(err);
    } else {
      setError(apiErrorMessage(err, fallback));
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await client.post("/student/checkin/code", { ticket, code: code.trim() });
      accept(res.data);
      setPhase(steps.location ? "location" : "confirm");
    } catch (err) {
      setCode("");
      stepFailed(err, "Incorrect code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function checkLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Location isn't available in this browser. Open this page in Chrome or Safari.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await client.post("/student/checkin/location", {
            ticket,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          accept(res.data);
          setDistance(res.data.distance_m);
          setPhase("confirm");
        } catch (err) {
          stepFailed(err, "We couldn't confirm your location. Please try again.");
        } finally {
          setBusy(false);
        }
      },
      () => {
        setBusy(false);
        setError("Location permission was denied or unavailable. Turn on location for this site in your browser settings and try again.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function complete(body) {
    const res = await client.post("/student/checkin/complete", body);
    setRecord(res.data);
    setPhase("done");
  }

  async function confirm() {
    if (steps.face) {
      setPhase("face");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("ticket", ticket);
      await complete(body);
    } catch (err) {
      stepFailed(err, "Check-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitFace(capture) {
    setError("");
    try {
      await complete(faceFormData(capture, { ticket }));
    } catch (err) {
      const data = err.response?.data || {};
      if (data.reason === "face_mismatch" && data.attempts_remaining === 0) {
        setRefusal({ reason: "face_mismatch", title: "Face verification unsuccessful", message: data.error });
        setPhase("refused");
      } else if (data.reason === "face_mismatch") {
        setError(
          `${data.error} You have ${data.attempts_remaining} attempt${data.attempts_remaining === 1 ? "" : "s"} left.`
        );
      } else {
        stepFailed(err, "Face verification failed. Please try again.");
      }
    }
  }

  if (!sessionToken && !boardMode) {
    return (
      <div className="mx-auto max-w-md py-10">
        <Notice
          tone="warning"
          icon={QrCode}
          title="Scan your lecturer's QR code"
          action={
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link to="/student-checkin?board=1">
                  <PenLine /> Use the code on the board
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/">Go to my dashboard</Link>
              </Button>
            </div>
          }
        >
          To check in, scan the QR code shown on your lecturer's screen during class. Each class has its own code. If your
          lecturer wrote a code on the board instead, use that.
        </Notice>
      </div>
    );
  }

  const stepList = STEPS.map((s) => ({
    ...s,
    enabled: steps[s.key],
    ...(boardMode && s.key === "code" ? { label: "Board code", icon: PenLine } : {}),
  }));
  const stepperCurrent = phase === "confirm" ? "location" : phase === "board" ? "code" : phase;

  return (
    <div className="mx-auto max-w-md space-y-4 py-4">
      {phase === "loading" && (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Opening check-in...
        </div>
      )}

      {phase === "refused" && refusal && (
        <Notice
          tone={refusal.reason === "already_checked_in" ? "success" : refusal.reason === "wrong_batch" ? "warning" : "danger"}
          icon={
            refusal.reason === "already_checked_in"
              ? CheckCircle2
              : refusal.reason === "wrong_batch"
                ? QrCode
                : refusal.reason === "face_mismatch"
                  ? ShieldX
                  : AlertTriangle
          }
          title={refusal.title}
          action={
            <div className="flex flex-col gap-2">
              {!FINAL_REASONS.includes(refusal.reason) && (
                <Button onClick={restart}>
                  <RotateCcw /> {refusal.reason === "no_class" ? "Check again" : "Start again"}
                </Button>
              )}
              <Button asChild variant="outline">
                <Link to="/">Go to my dashboard</Link>
              </Button>
            </div>
          }
        >
          {refusal.message}
          {refusal.reason !== "already_checked_in" && <p className="mt-2">You have not been checked in.</p>}
        </Notice>
      )}

      {session && !["loading", "refused"].includes(phase) && (
        <>
          <Card className="p-5">
            <p className="font-semibold">{session.course_name}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{session.batch}</span>
              {session.lecturer_name && (
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" /> {session.lecturer_name}
                </span>
              )}
              {session.room && (
                <span className="flex items-center gap-1">
                  <DoorOpen className="h-3.5 w-3.5" /> {session.room}
                </span>
              )}
              <span className="flex items-center gap-1 tabular-nums">
                <Clock className="h-3.5 w-3.5" /> {formatTime(session.scheduled_start)} - {formatTime(session.scheduled_end)}
              </span>
            </p>
          </Card>

          {phase !== "done" && <Stepper steps={stepList} current={stepperCurrent} />}

          <motion.div key={phase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {phase === "board" && (
              <Card>
                <CardContent className="p-6">
                  <form onSubmit={submitBoard} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="board-code">Board code</Label>
                      <p className="text-sm text-muted-foreground">
                        Enter the {session.board_code_digits}-digit code your lecturer wrote on the board.
                      </p>
                      <Input
                        id="board-code"
                        autoFocus
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={session.board_code_digits}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        className="h-14 text-center text-2xl font-semibold tracking-[0.5em]"
                      />
                    </div>
                    {error && <Alert>{error}</Alert>}
                    <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== session.board_code_digits}>
                      {busy ? <Loader2 className="animate-spin" /> : <PenLine />} Continue
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {phase === "code" && (
              <Card>
                <CardContent className="p-6">
                  <form onSubmit={submitCode} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="class-code">Class code</Label>
                      <p className="text-sm text-muted-foreground">Enter the {session.code_digits}-digit code shown on your lecturer's screen.</p>
                      <Input
                        id="class-code"
                        autoFocus
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={session.code_digits}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        className="h-14 text-center text-2xl font-semibold tracking-[0.4em]"
                      />
                    </div>
                    {error && <Alert>{error}</Alert>}
                    <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== session.code_digits}>
                      {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Continue
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {phase === "location" && (
              <Card>
                <CardContent className="space-y-4 p-6">
                  <div>
                    <p className="font-medium">Confirm you're on campus</p>
                    <p className="mt-1 text-sm text-muted-foreground">Turn on location so we can check you're at the campus.</p>
                  </div>
                  {error && <Alert>{error}</Alert>}
                  <Button size="lg" className="w-full" onClick={checkLocation} disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <MapPin />} {busy ? "Checking location..." : "Turn on location"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {phase === "confirm" && (
              <Card>
                <CardContent className="space-y-4 p-6">
                  {distance != null && (
                    <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        You're on campus <span className="text-success/80">(about {distance} m from the campus centre)</span>.
                      </p>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {steps.face
                      ? "Last step: a quick face scan to confirm it's you."
                      : "Confirm to record your attendance for this class."}
                  </p>
                  {error && <Alert>{error}</Alert>}
                  <Button size="lg" className="w-full" onClick={confirm} disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirm
                  </Button>
                </CardContent>
              </Card>
            )}

            {phase === "face" && (
              <Card>
                <CardContent className="p-6">
                  <FaceCapture direction={challenge} onCapture={submitFace} error={error} startLabel="Scan my face" />
                </CardContent>
              </Card>
            )}

            {phase === "done" && record && (
              <Notice
                tone={record.status === "absent" ? "warning" : "success"}
                icon={record.status === "absent" ? AlertTriangle : CheckCircle2}
                title={record.status === "absent" ? "Checked in, but recorded as absent" : "You're marked present"}
                action={
                  <Button asChild variant="outline">
                    <Link to="/">Go to my dashboard</Link>
                  </Button>
                }
              >
                <div className="flex flex-col items-center gap-2">
                  <StatusBadge status={record.status} label={record.status_label} />
                  <p>
                    {record.status === "absent"
                      ? "You arrived too long after the class started, so this session counts as absent. Speak to your lecturer if you had a reason."
                      : `Checked in at ${formatTime(record.checkin_at)}.`}
                  </p>
                </div>
              </Notice>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}
