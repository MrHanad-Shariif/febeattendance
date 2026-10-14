import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useApi } from "@/components/committees/shared";
import ExportMenu from "@/components/ExportMenu.jsx";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pct } from "@/lib/attendance";

const ALL = "all";
const h = (title) => ({ column }) => <DataTableColumnHeader column={column} title={title} />;
const num = (key, title) => ({ accessorKey: key, header: h(title), meta: { label: title, className: "text-right" }, cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> });

function Stat({ label, value, tone = "" }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </Card>
  );
}

/** Planned, held, cancelled and remaining sessions per course, for the semester. */
export function CourseSessions({ batches }) {
  const [batch, setBatch] = useState(ALL);
  const { data, loading, error } = useApi(`/admin/timetable/sessions${batch === ALL ? "" : `?batch=${encodeURIComponent(batch)}`}`, null);
  const columns = useMemo(
    () => [
      { accessorKey: "batch", header: h("Class"), meta: { label: "Class" } },
      { accessorKey: "course_name", header: h("Course"), meta: { label: "Course" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
      { accessorKey: "lecturer_name", header: h("Lecturer"), meta: { label: "Lecturer" }, cell: ({ getValue }) => getValue() || "Not assigned" },
      {
        accessorKey: "planned_sessions",
        header: h("Planned"),
        meta: { label: "Planned" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 tabular-nums">
            {row.original.planned_sessions}
            {row.original.differs_from_target && (
              <span title={`The faculty standard is ${row.original.target_sessions}`}>
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              </span>
            )}
          </span>
        ),
      },
      num("held_sessions", "Held"),
      num("cancelled_sessions", "Cancelled"),
      num("missed_sessions", "Missed"),
      num("remaining_sessions", "Remaining"),
      num("teaching_hours", "Teaching hours"),
      { accessorKey: "completion_percent", header: h("Completion"), meta: { label: "Completion %" }, cell: ({ getValue }) => pct(getValue()) },
    ],
    []
  );
  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={batch} onValueChange={setBatch}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classes</SelectItem>
            {batches.map((b) => (
              <SelectItem key={b.code} value={b.code}>
                {b.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ExportMenu url="/admin/timetable/sessions/export" params={batch === ALL ? {} : { batch }} name="Course_Sessions" />
      </div>
      {error && <Alert>{error}</Alert>}
      {t && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Planned" value={t.planned_sessions} />
          <Stat label="Held" value={t.held_sessions} tone="text-success" />
          <Stat label="Cancelled" value={t.cancelled_sessions} />
          <Stat label="Missed" value={t.missed_sessions} tone="text-danger" />
          <Stat label="Remaining" value={t.remaining_sessions} />
          <Stat label="Teaching hours" value={t.teaching_hours} />
          <Stat label="Completion" value={pct(t.completion_percent)} tone="text-primary" />
        </div>
      )}
      {data && (
        <p className="text-xs text-muted-foreground">
          {data.semester.name}. Planned sessions come from the timetable (or the total set on a class); the faculty standard is{" "}
          <Badge variant="outline">{data.target_sessions}</Badge>, and courses that differ are marked. Held and cancelled sessions are counted up to {data.as_of};
          cancelled = covered by an official lecturer absence.
        </p>
      )}
      <DataTable columns={columns} data={data?.courses || []} loading={loading} getRowId={(r) => `${r.batch}-${r.course_name}`} exportName="course-sessions" emptyText="No classes." />
    </div>
  );
}

/** Classes that share a lecturer or a room at the same time. */
export function TimetableClashes() {
  const { data, loading, error } = useApi("/admin/timetable/clashes", []);
  if (loading) return <p className="text-sm text-muted-foreground">Checking...</p>;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) return <Alert variant="success">No clashes: no lecturer or room is booked twice at the same time.</Alert>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {data.length} pair{data.length === 1 ? "" : "s"} of classes share a lecturer or room at the same time. Combined classes taught together are fine; anything else should be
        moved.
      </p>
      {data.map((c, i) => (
        <Card key={i} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <div>
            <p className="font-medium">
              {c.a.course_name} ({c.a.batch || "—"}) and {c.b.course_name} ({c.b.batch || "—"})
            </p>
            <p className="text-muted-foreground">
              {c.days.join(", ")} · {c.a.time} and {c.b.time} · {c.a.lecturer_name || "no lecturer"} · room {c.a.room || "—"}
              {c.b.room && c.b.room !== c.a.room ? ` / ${c.b.room}` : ""}
            </p>
          </div>
          <div className="flex gap-1">
            {c.clash.map((x) => (
              <Badge key={x} variant="warning">
                Same {x}
              </Badge>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
