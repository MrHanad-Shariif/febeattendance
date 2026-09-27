import { useMemo } from "react";
import { BookOpen, CalendarRange, Clock, GraduationCap } from "lucide-react";
import { useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SemesterBadge, WeeklyTimetable } from "@/components/timetable/WeeklyTimetable.jsx";
import { formatDate } from "@/lib/committees";

function minutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A lecturer's whole semester in one place: weekly classes and the courses
 * the faculty assigned to them. */
export default function LecturerTimetable() {
  const { data, loading, error } = useApi("/me/timetable");
  const entries = data?.entries || [];
  const courses = data?.courses || [];

  const stats = useMemo(() => {
    let weekly = 0;
    let hours = 0;
    for (const e of entries) {
      weekly += e.days.length;
      if (e.start_time && e.end_time) hours += (e.days.length * (minutes(e.end_time) - minutes(e.start_time))) / 60;
    }
    const batches = new Set(entries.map((e) => e.batch).filter(Boolean));
    const courseNames = new Set([...entries.map((e) => e.course_name), ...courses.map((c) => c.name)]);
    return { weekly, hours: Math.round(hours * 10) / 10, batches: batches.size, courses: courseNames.size };
  }, [entries, courses]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My timetable"
        description={
          data?.semester_start_date
            ? `Your whole semester, ${formatDate(data.semester_start_date)} to ${formatDate(data.semester_end_date)}.`
            : "Your whole semester, day by day."
        }
        actions={<SemesterBadge name={data?.semester_name} />}
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Courses" value={stats.courses} icon={BookOpen} index={0} />
        <StatCard title="Classes" value={stats.batches} icon={GraduationCap} tone="info" index={1} />
        <StatCard title="Sessions a week" value={stats.weekly} icon={CalendarRange} tone="purple" index={2} />
        <StatCard title="Teaching hours a week" value={stats.hours} icon={Clock} tone="success" index={3} />
      </div>

      <WeeklyTimetable entries={entries} loading={loading} show="batch" emptyText="No classes are scheduled for you yet." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Courses assigned to you</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {courses.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No courses have been assigned to you in the course list yet. Your classes above come from the timetable.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Credit hours</TableHead>
                    <TableHead>Semester</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.code || "—"}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.batch || "—"}</TableCell>
                      <TableCell>{c.department || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.credit_hours ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{c.semester || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
