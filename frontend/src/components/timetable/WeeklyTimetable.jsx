import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarOff, DoorOpen, User, Users } from "lucide-react";
import client from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const DAY_ORDER = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_NAMES = { Sat: "Saturday", Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
const TODAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];

function groupByDay(entries) {
  const byDay = Object.fromEntries(DAY_ORDER.map((d) => [d, []]));
  for (const e of entries) {
    for (const day of e.days) {
      if (byDay[day]) byDay[day].push(e);
    }
  }
  for (const day of DAY_ORDER) {
    byDay[day].sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  }
  return byDay;
}

/** The current semester's name, e.g. "October 2026 - February 2027". */
export function useSemester() {
  const [semester, setSemester] = useState(null);
  useEffect(() => {
    client
      .get("/semester")
      .then((res) => setSemester(res.data))
      .catch(() => setSemester(null));
  }, []);
  return semester;
}

export function SemesterBadge({ name }) {
  if (!name) return null;
  return (
    <Badge variant="secondary" className="whitespace-nowrap">
      Semester: {name}
    </Badge>
  );
}

/**
 * A week of classes, one card per teaching day. `show` picks the secondary
 * line: "lecturer" for students, "batch" for lecturers.
 */
export function WeeklyTimetable({ entries, loading, show = "lecturer", emptyText = "No classes in the timetable yet." }) {
  const byDay = useMemo(() => groupByDay(entries || []), [entries]);
  const activeDays = DAY_ORDER.filter((d) => byDay[d].length > 0);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (!entries?.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <CalendarOff className="h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {activeDays.map((day, i) => (
        <motion.div key={day} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
          <Card className={day === TODAY ? "border-primary/60 ring-1 ring-primary/30" : undefined}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">{DAY_NAMES[day]}</CardTitle>
              {day === TODAY && <Badge className="bg-primary text-primary-foreground">Today</Badge>}
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {byDay[day].map((e) => (
                  <li key={`${e.id}-${day}`} className="flex gap-4 py-3">
                    <span className="w-28 shrink-0 text-sm font-medium tabular-nums text-primary">
                      {e.start_time || "—"} - {e.end_time || "—"}
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{e.course_name}</p>
                      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        {show === "batch" ? (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" /> {e.batch || "—"}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> {e.lecturer_name}
                          </span>
                        )}
                        {e.room && (
                          <span className="flex items-center gap-1">
                            <DoorOpen className="h-3 w-3" /> {e.room}
                          </span>
                        )}
                        {e.sessions > 1 && <span>{e.sessions} sessions</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
