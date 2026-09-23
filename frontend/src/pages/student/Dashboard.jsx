import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarOff, Clock, DoorOpen, LogIn, User } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge from "@/components/StatusBadge.jsx";
import VerifyModal from "@/components/VerifyModal.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatTime } from "@/lib/utils";

function isOngoing(row) {
  if (!row.scheduled_start) return false;
  const now = new Date();
  const start = new Date(row.scheduled_start);
  const end = row.scheduled_end ? new Date(row.scheduled_end) : null;
  return now >= start && (!end || now <= end);
}

export default function StudentDashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modalRow, setModalRow] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");
  const [blockNotice, setBlockNotice] = useState(null);

  async function load(initial = false) {
    if (initial) setLoading(true);
    try {
      const res = await client.get("/student/today");
      setRows(res.data);
      setLoadError("");
    } catch (err) {
      setLoadError(apiErrorMessage(err, "Could not load today's classes"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleVerify({ code, lat, lng }) {
    setSubmitting(true);
    setModalError("");
    try {
      await client.post("/student/checkin", { timetable_id: modalRow.timetable_id, code, lat, lng });
      toast.success("Checked in");
      setModalRow(null);
      load();
    } catch (err) {
      if (err.response?.status === 403 && err.response.data?.course_stats) {
        setModalRow(null);
        setBlockNotice(err.response.data.error);
        load();
      } else {
        setModalError(apiErrorMessage(err, "Verification failed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description="Scan the QR code posted in your classroom, read the code from your lecturer's screen, and allow location to check in."
      />

      {blockNotice && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Check-in blocked</p>
            <p className="mt-1">{blockNotice}</p>
            <button onClick={() => setBlockNotice(null)} className="mt-2 text-xs font-medium underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loadError && <Alert>{loadError}</Alert>}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CalendarOff className="h-10 w-10 text-muted-foreground/60" />
            <p className="font-medium">No classes scheduled today</p>
            <p className="text-sm text-muted-foreground">Check your timetable for the rest of the week.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => {
            const ongoing = isOngoing(row);
            const canCheckIn = row.status === "not_yet";
            return (
              <motion.div key={row.timetable_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className={cn("p-5", ongoing && "border-primary/60 ring-1 ring-primary/30")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {row.course_name}
                        {ongoing && <Badge className="bg-primary text-primary-foreground">Ongoing now</Badge>}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" /> {row.lecturer_name}
                        </span>
                        {row.room && (
                          <span className="flex items-center gap-1">
                            <DoorOpen className="h-3.5 w-3.5" /> {row.room}
                          </span>
                        )}
                        <span className="flex items-center gap-1 tabular-nums">
                          <Clock className="h-3.5 w-3.5" /> {formatTime(row.scheduled_start)} - {formatTime(row.scheduled_end)}
                        </span>
                      </p>
                    </div>
                    <StatusBadge status={row.status} label={row.status_label} />
                  </div>

                  {row.course_stats?.needs_retake && (
                    <p className="mt-3 flex items-center gap-2 text-xs text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      You've missed {row.course_stats.absence_percentage}% of this course's sessions so far.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <Button
                      disabled={!canCheckIn}
                      onClick={() => {
                        setModalError("");
                        setModalRow(row);
                      }}
                    >
                      <LogIn /> Check in
                    </Button>
                    <span className="text-sm text-muted-foreground">Checked in: {formatTime(row.checkin_at)}</span>
                    {row.remarks && <span className="text-sm text-muted-foreground/80">Note: {row.remarks}</span>}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {modalRow && (
        <VerifyModal
          title={`Check in - ${modalRow.course_name}`}
          actionLabel="Check in"
          onCancel={() => setModalRow(null)}
          onSubmit={handleVerify}
          submitting={submitting}
          error={modalError}
          codePlaceholder="4-digit code from your lecturer's screen"
          codeMaxLength={4}
          helperText="Confirm you are on campus: enter the code your lecturer is showing on their laptop, and allow location access."
        />
      )}
    </div>
  );
}
