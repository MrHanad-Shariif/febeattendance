import { useEffect, useMemo, useState } from "react";
import { Award, Info, Medal, Printer } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import ExportMenu from "@/components/ExportMenu.jsx";
import PeriodFields, { periodParams, periodReady } from "@/components/PeriodFields.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SYSTEM_FULL_NAME } from "@/lib/committees";
import { currentMonth, pct, todayIso } from "@/lib/attendance";

const ALL = "all";
const CUSTOM = "custom";
const MEDALS = ["text-yellow-500", "text-gray-400", "text-amber-700"];
const QUICK = ["3", "5", "10", "20", "50", "100"];

const COLUMNS = {
  lecturers: [
    ["name", "Lecturer"],
    ["department", "Department"],
    ["scheduled_sessions", "Scheduled", "n"],
    ["held_sessions", "Held", "n"],
    ["attended", "Attended", "n"],
    ["unjustified_absences", "Absences", "n"],
    ["justified_absences", "Justified", "n"],
    ["late", "Late", "n"],
    ["late_minutes", "Late min.", "n"],
    ["attendance_rate", "Attendance %", "pct"],
  ],
  students: [
    ["name", "Student"],
    ["student_id_number", "Student ID"],
    ["student_class", "Class"],
    ["held_sessions", "Held", "n"],
    ["attended", "Attended", "n"],
    ["absences", "Absences", "n"],
    ["justified_absences", "Justified", "n"],
    ["late", "Late", "n"],
    ["attendance_rate", "Attendance %", "pct"],
  ],
};

function Field({ label, children, className = "" }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Choice({ value, onChange, options, placeholder }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RankingTable({ rows, audience, metricField }) {
  const cols = COLUMNS[audience];
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nobody to rank for this period and these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Rank</TableHead>
            {cols.map(([k, l, kind]) => (
              <TableHead key={k} className={`${kind ? "text-right" : ""} ${k === metricField ? "text-primary" : ""}`}>
                {l}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <span className="inline-flex items-center gap-1 font-semibold">
                  {r.rank <= 3 ? <Medal className={`h-4 w-4 ${MEDALS[r.rank - 1]}`} /> : null}
                  {r.rank}
                  {r.tied && (
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      Tie
                    </Badge>
                  )}
                </span>
              </TableCell>
              {cols.map(([k, , kind]) => (
                <TableCell key={k} className={`${kind ? "text-right tabular-nums" : ""} ${k === "name" ? "font-medium" : ""} ${k === metricField ? "font-semibold text-primary" : ""}`}>
                  {kind === "pct" ? pct(r[k]) : r[k] ?? "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

export default function AttendanceRankings() {
  const [audience, setAudience] = useState("students");
  const [q, setQ] = useState({
    period: "semester", date: todayIso(), month: currentMonth(), year: "", from: "", to: "",
    metric: "attendance_rate", order: "best", show: "10", custom: "25", per_class: true, min_sessions: "1",
    batch: ALL, course: ALL, department: ALL, lecturer_id: ALL, student_id: ALL,
  });
  const [options, setOptions] = useState({ lecturers: [], students: [], batches: [], courses: [] });
  const [rankOptions, setRankOptions] = useState({ metrics: { lecturers: [], students: [] }, departments: [] });
  const [data, setData] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/admin/attendance-reports/options").then((res) => setOptions(res.data)).catch(() => {});
    client.get("/admin/attendance-reports/ranking-options").then((res) => setRankOptions(res.data)).catch(() => {});
  }, []);

  const set = (patch) => setQ((s) => ({ ...s, ...patch }));
  const limit = q.show === ALL ? "all" : q.show === CUSTOM ? q.custom : q.show;
  const customBad = q.show === CUSTOM && !(Number(q.custom) >= 1 && Number.isInteger(Number(q.custom)));
  const ready = periodReady(q) && !customBad;

  const params = useMemo(() => {
    const p = { ...periodParams(q), audience, metric: q.metric, order: q.order, limit, min_sessions: q.min_sessions || 0 };
    if (audience === "students") p.per_class = q.per_class ? 1 : 0;
    for (const k of ["batch", "course", "department", "lecturer_id"]) if (q[k] !== ALL) p[k] = q[k];
    if (audience === "students" && q.student_id !== ALL) p.student_id = q.student_id;
    return p;
  }, [q, audience, limit]);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    setError("");
    client
      .get("/admin/attendance-reports/ranking-table", { params })
      .then((res) => setData(res.data))
      .catch((err) => {
        setError(apiErrorMessage(err));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [params, ready]);

  useEffect(() => {
    const p = q.batch !== ALL ? { batch: q.batch } : {};
    client.get("/admin/attendance-reports/warnings", { params: p }).then((res) => setWarnings(res.data)).catch(() => setWarnings(null));
  }, [q.batch]);

  const metrics = rankOptions.metrics[audience] || [];
  const s = data?.summary || {};
  const exportParams = { ...params, audience: "ranking", ranking_audience: audience };

  const warningColumns = useMemo(
    () => [
      { accessorKey: "student_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Student" />, meta: { label: "Student" } },
      { accessorKey: "student_id_number", header: "ID number", meta: { label: "ID number" } },
      { accessorKey: "class_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Class" />, meta: { label: "Class" }, filterFn: "equalsString" },
      { accessorKey: "course_name", header: "Course", meta: { label: "Course" } },
      { accessorKey: "effective_absences", header: ({ column }) => <DataTableColumnHeader column={column} title="Absences" />, meta: { label: "Effective absences" } },
      { accessorKey: "total_sessions", header: "Planned", meta: { label: "Planned sessions" } },
      { accessorKey: "absence_percentage", header: ({ column }) => <DataTableColumnHeader column={column} title="Absence %" />, meta: { label: "Absence %" }, cell: ({ getValue }) => `${getValue()}%` },
      {
        accessorKey: "level",
        header: "Level",
        meta: { label: "Level", exportValue: (r) => r.level_label },
        filterFn: "equalsString",
        cell: ({ row }) => <Badge variant={row.original.level === "blocked" ? "danger" : "warning"}>{row.original.level_label}</Badge>,
      },
    ],
    []
  );

  const people = audience === "lecturers" ? "lecturers" : "students";

  return (
    <div className="space-y-6">
      <div className="hidden print:block">
        <p className="text-sm font-semibold text-primary">{SYSTEM_FULL_NAME}</p>
        <h1 className="text-xl font-bold">
          {audience === "lecturers" ? "Lecturer" : "Student"} attendance rankings: {data?.metric_label}
        </h1>
        <p className="text-sm">
          {data?.label} · {data?.scope}
        </p>
      </div>
      <div className="print:hidden">
        <PageHeader
          title="Attendance rankings"
          description="Rank students (within their class) or lecturers by attendance and punctuality, best or worst first, for any number of people."
          actions={
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> Print
              </Button>
              <ExportMenu url="/admin/attendance-reports/export" params={exportParams} name={`${audience === "lecturers" ? "Lecturer" : "Student"}_Rankings`} disabled={!ready} />
            </>
          }
        />
      </div>

      <div className="space-y-4 print:hidden">
        <Tabs
          value={audience}
          onValueChange={(v) => {
            setAudience(v);
            set({ metric: "attendance_rate" });
          }}
        >
          <TabsList>
            <TabsTrigger value="students">Students</TabsTrigger>
            <TabsTrigger value="lecturers">Lecturers</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="Rank by">
            <Choice value={q.metric} onChange={(v) => set({ metric: v })} options={metrics.map((m) => [m.value, m.label])} placeholder="Attendance rate" />
          </Field>
          <Field label="Order">
            <Choice value={q.order} onChange={(v) => set({ order: v })} options={[["best", "Best to worst"], ["worst", "Worst to best"]]} />
          </Field>
          <Field label="Show">
            <Choice
              value={q.show}
              onChange={(v) => set({ show: v })}
              options={[...QUICK.map((n) => [n, `Top ${n}`]), [CUSTOM, "Custom number..."], [ALL, `All eligible ${people}`]]}
            />
          </Field>
          {q.show === CUSTOM && (
            <Field label="How many">
              <Input type="number" min={1} step={1} value={q.custom} onChange={(e) => set({ custom: e.target.value })} />
            </Field>
          )}
          <PeriodFields q={q} set={set} />
          <Field label="Class">
            <Choice value={q.batch} onChange={(v) => set({ batch: v, student_id: ALL })} options={[[ALL, "All classes"], ...options.batches.map((b) => [b, b])]} />
          </Field>
          <Field label="Course">
            <Choice value={q.course} onChange={(v) => set({ course: v })} options={[[ALL, "All courses"], ...options.courses.map((c) => [c, c])]} />
          </Field>
          <Field label="Department">
            <Choice value={q.department} onChange={(v) => set({ department: v })} options={[[ALL, "All departments"], ...rankOptions.departments.map((d) => [d, d])]} />
          </Field>
          <Field label="Lecturer">
            <Choice value={q.lecturer_id} onChange={(v) => set({ lecturer_id: v })} options={[[ALL, "All lecturers"], ...options.lecturers.map((l) => [String(l.id), l.name])]} />
          </Field>
          {audience === "students" && (
            <Field label="Student">
              <Choice
                value={q.student_id}
                onChange={(v) => set({ student_id: v })}
                options={[
                  [ALL, "All students"],
                  ...options.students.filter((x) => q.batch === ALL || x.batch === q.batch).map((x) => [String(x.id), `${x.name} (${x.student_id_number || "no ID"})`]),
                ]}
              />
            </Field>
          )}
          <Field label="Minimum sessions to be ranked">
            <Input type="number" min={0} value={q.min_sessions} onChange={(e) => set({ min_sessions: e.target.value })} />
          </Field>
          {audience === "students" && (
            <Field label="Rank within each class">
              <div className="flex h-10 items-center gap-2">
                <Switch checked={q.per_class} onCheckedChange={(v) => set({ per_class: v })} />
                <span className="text-sm">{q.per_class ? "Separate ranking per class" : "One ranking for everyone"}</span>
              </div>
            </Field>
          )}
        </div>
        {customBad && <Alert>Enter a whole number of 1 or more.</Alert>}
      </div>

      {error && <Alert>{error}</Alert>}
      {loading && !data && <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>}

      {data && (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex gap-3 p-4 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-1">
                <p>
                  <strong>{data.label}.</strong> {data.method}
                </p>
                <p className="text-muted-foreground">
                  {data.limit ? `Showing the top ${data.limit}${data.per_class ? " in each class" : ""} (anyone tied at the cut-off is included). ` : "Showing everyone eligible. "}
                  {data.excluded_count > 0 && `${data.excluded_count} with fewer than ${data.min_sessions} accountable sessions are not ranked.`}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={audience === "lecturers" ? "Lecturers ranked" : "Students ranked"} value={s.people ?? 0} />
            <Stat label="Average attendance" value={pct(s.average_attendance_rate)} tone="text-success" />
            <Stat label="Sessions held" value={s.held_sessions ?? 0} />
            <Stat label="Unjustified absences" value={s.absences ?? 0} tone="text-danger" />
            <Stat label="Justified absences" value={s.justified_absences ?? 0} tone="text-info" />
            {audience === "lecturers" ? <Stat label="Late minutes" value={s.late_minutes ?? 0} tone="text-warning" /> : <Stat label="Late arrivals" value={s.late ?? 0} tone="text-warning" />}
          </div>

          {data.per_class ? (
            data.groups.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">Nobody to rank for this period and these filters.</CardContent>
              </Card>
            ) : (
              data.groups.map((g) => (
                <Card key={g.class_name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Class {g.class_name}</CardTitle>
                    <CardDescription>
                      {g.rows.length} shown of {g.eligible} ranked students
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <RankingTable rows={g.rows} audience={audience} metricField={data.metric_field} />
                  </CardContent>
                </Card>
              ))
            )
          ) : (
            <Card>
              <CardContent className="pt-4">
                <RankingTable rows={data.rows} audience={audience} metricField={data.metric_field} />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {warnings && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 pb-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4 text-primary" /> Students requiring warnings
              </CardTitle>
              <CardDescription>
                Semester standing per course: a warning from {warnings.warning_percent}% of planned sessions missed; at {warnings.threshold_percent}% the
                course must be retaken. Exempted sessions are not counted.
              </CardDescription>
            </div>
            <ExportMenu
              url="/admin/attendance-reports/export"
              params={{ audience: "warnings", ...(q.batch !== ALL ? { batch: q.batch } : {}), period: "semester" }}
              name="Student_Warnings"
            />
          </CardHeader>
          <CardContent>
            <DataTable
              columns={warningColumns}
              data={warnings.rows}
              getRowId={(r) => `${r.student_id}-${r.class_name}-${r.course_name}`}
              searchPlaceholder="Search students or courses..."
              filters={[
                { columnId: "class_name", label: "Class" },
                { columnId: "level", label: "Level", options: [{ value: "warning", label: "Warning" }, { value: "blocked", label: "Over the limit" }] },
              ]}
              exportName="student-warnings"
              emptyText="No student is near the absence limit."
              pageSize={20}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
