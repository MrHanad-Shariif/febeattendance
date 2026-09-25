import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarOff, Clock, DoorOpen, QrCode, User } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge from "@/components/StatusBadge.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description="To check in, scan the QR code on your lecturer's screen during class, then follow the steps."
      />

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
                    {row.blocked ? (
                      <span className="flex items-center gap-2 text-sm text-danger">
                        <AlertTriangle className="h-4 w-4" /> Check-in blocked: your absences in this course reached the limit.
                      </span>
                    ) : canCheckIn ? (
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <QrCode className="h-4 w-4 text-primary" /> Scan the QR code on your lecturer's screen to check in.
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Checked in: {formatTime(row.checkin_at)}</span>
                    )}
                    {row.remarks && <span className="text-sm text-muted-foreground/80">Note: {row.remarks}</span>}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

    </div>
  );
}
