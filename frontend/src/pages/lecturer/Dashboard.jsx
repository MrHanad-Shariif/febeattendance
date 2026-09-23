import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarOff, Clock, DoorOpen, LogIn, LogOut, MapPin, StickyNote } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge from "@/components/StatusBadge.jsx";
import VerifyModal from "@/components/VerifyModal.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/utils";

function TimeTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [day, setDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modalAction, setModalAction] = useState(null); // "checkin" | "checkout" | null
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");

  async function load(initial = false) {
    if (initial) setLoading(true);
    try {
      const res = await client.get("/me/today");
      setDay(res.data[0] || null);
      setLoadError("");
    } catch (err) {
      setLoadError(apiErrorMessage(err, "Could not load today's schedule"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  async function handleVerify({ code, lat, lng, note }) {
    setSubmitting(true);
    setModalError("");
    try {
      await client.post(`/attendance/${modalAction}`, { code, lat, lng, note });
      toast.success(modalAction === "checkin" ? "Checked in" : "Checked out");
      setModalAction(null);
      load();
    } catch (err) {
      setModalError(apiErrorMessage(err, "Verification failed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError) return <Alert>{loadError}</Alert>;

  if (!day) {
    return (
      <div className="space-y-6">
        <PageHeader title="Today" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CalendarOff className="h-10 w-10 text-muted-foreground/60" />
            <p className="font-medium">No classes scheduled today</p>
            <p className="text-sm text-muted-foreground">Enjoy the day — check back on your next teaching day.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canCheckIn = !day.checkin_at;
  const canCheckOut = day.checkin_at && !day.checkout_at;
  const classes = day.classes || [];
  const multiple = classes.length > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description={
          multiple
            ? `You have ${classes.length} classes today. Check in once before your first class and check out once after your last.`
            : "Enter the campus code from the kiosk screen and allow location access to check in or out."
        }
      />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                {multiple ? "Today's classes" : classes[0].course_name}
                {!multiple && classes[0].batch && <Badge>{classes[0].batch}</Badge>}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                First class {formatTime(day.scheduled_start)} · Last class ends {formatTime(day.scheduled_end)}
              </p>
            </div>
            <StatusBadge status={day.status} label={day.status_label} className="px-3 py-1 text-sm" />
          </CardHeader>
          <CardContent className="space-y-5">
            {multiple && (
              <ul className="divide-y rounded-lg border">
                {classes.map((c) => (
                  <li key={c.timetable_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                    <span className="tabular-nums text-muted-foreground">
                      {c.start_time}–{c.end_time || "?"}
                    </span>
                    <span className="font-medium">{c.course_name}</span>
                    {c.batch && <Badge variant="secondary">{c.batch}</Badge>}
                    {c.room && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <DoorOpen className="h-3.5 w-3.5" /> {c.room}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <TimeTile icon={LogIn} label="Checked in" value={formatTime(day.checkin_at)} />
              <TimeTile icon={LogOut} label="Checked out" value={formatTime(day.checkout_at)} />
            </div>

            {day.remarks && (
              <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">Remarks:</span> {day.remarks}
                </span>
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                disabled={!canCheckIn}
                onClick={() => {
                  setModalError("");
                  setModalAction("checkin");
                }}
              >
                <LogIn /> Check in
              </Button>
              <Button
                size="lg"
                variant="outline"
                disabled={!canCheckOut}
                onClick={() => {
                  setModalError("");
                  setModalAction("checkout");
                }}
              >
                <LogOut /> Check out
              </Button>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Location is verified against the campus when you check in or out.
              <Clock className="ml-2 h-3.5 w-3.5" /> Status refreshes every minute.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {modalAction && (
        <VerifyModal
          title={modalAction === "checkin" ? "Check in for today" : "Check out for today"}
          actionLabel={modalAction === "checkin" ? "Check in" : "Check out"}
          onCancel={() => setModalAction(null)}
          onSubmit={handleVerify}
          submitting={submitting}
          error={modalError}
          showNote={modalAction === "checkout"}
          noteLabel="Leaving early? Give a reason (optional)"
        />
      )}
    </div>
  );
}
