import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileSpreadsheet, Printer, Trophy } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SYSTEM_FULL_NAME } from "@/lib/committees";
import { CATEGORIES, currentMonth, downloadFile, pct, todayIso } from "@/lib/attendance";

const ALL = "all";
const PERIODS = [
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
  { value: "semester", label: "Semester" },
  { value: "range", label: "Date range" },
];

function header(title) {
  return ({ column }) => <DataTableColumnHeader column={column} title={title} />;
}

function countCol(key, title, danger) {
  return {
    accessorKey: key,
    header: header(title),
    meta: { label: title },
    cell: ({ getValue }) => (getValue() > 0 && danger ? <span className="font-semibold text-danger">{getValue()}</span> : getValue()),
  };
}

function pctCol(key, title) {
  return { accessorKey: key, header: header(title), meta: { label: title }, cell: ({ getValue }) => pct(getValue()) };
}

function statusCell({ row }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={CATEGORIES[row.original.category]?.variant} className="whitespace-nowrap">
        {row.original.status_label}
      </Badge>
      {row.original.flagged_for_review && (
        <Badge variant="outline" className="text-[10px]">
          Review
        </Badge>
      )}
    </div>
  );
}

const LECTURER_SUMMARY = [
  { accessorKey: "name", header: header("Lecturer"), meta: { label: "Lecturer" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
  countCol("scheduled_sessions", "Scheduled"),
  countCol("counted_sessions", "Counted"),
  countCol("present", "Present"),
  countCol("late", "Late"),
  countCol("absent", "Absent (unjust.)", true),
  countCol("justified", "Justified"),
  countCol("left_early", "Left early"),
  countCol("no_checkout", "No check-out"),
  pctCol("present_rate", "On-time %"),
  pctCol("late_rate", "Late %"),
  pctCol("absent_rate", "Unjust. abs. %"),
  pctCol("attendance_rate", "Attendance %"),
];

const STUDENT_SUMMARY = [
  { accessorKey: "name", header: header("Student"), meta: { label: "Student" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
  { accessorKey: "student_id_number", header: header("ID number"), meta: { label: "ID number" } },
  { accessorKey: "student_class", header: header("Class"), meta: { label: "Class" } },
  countCol("counted_sessions", "Counted"),
  countCol("present", "Present"),
  countCol("late", "Late"),
  countCol("absent", "Absent (unjust.)", true),
  countCol("justified", "Justified"),
  countCol("exempted", "Exempted"),
  pctCol("present_rate", "Present %"),
  pctCol("late_rate", "Late %"),
  pctCol("absent_rate", "Absent %"),
  pctCol("attendance_rate", "Attendance %"),
];

const text = (key, title, extra = {}) => ({ accessorKey: key, header: header(title), meta: { label: title }, cell: ({ getValue }) => getValue() || "", ...extra });

const LECTURER_DETAIL = [
  text("date", "Date", { cell: ({ row }) => <span className="whitespace-nowrap">{row.original.day} {row.original.date}</span> }),
  text("lecturer_name", "Lecturer"),
  text("session_number", "Session"),
  text("class_name", "Class"),
  text("course_name", "Course / subject"),
  text("scheduled_time", "Scheduled", { cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span> }),
  text("checkin_at", "Check-in"),
  text("checkout_at", "Check-out"),
  { id: "status", accessorKey: "status_label", header: header("Status"), meta: { label: "Status" }, cell: statusCell },
  text("justification", "Justification"),
  text("remarks", "Remarks", { enableSorting: false, cell: ({ getValue }) => <span className="text-xs">{getValue() || ""}</span> }),
];

const STUDENT_DETAIL = [
  text("date", "Date", { cell: ({ row }) => <span className="whitespace-nowrap">{row.original.day} {row.original.date}</span> }),
  text("student_name", "Student"),
  text("student_id_number", "ID number"),
  text("session_number", "Session"),
  text("class_name", "Class"),
  text("course_name", "Course / subject"),
  text("lecturer_name", "Lecturer"),
  text("scheduled_time", "Scheduled", { cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span> }),
  text("checkin_at", "Check-in"),
  { id: "status", accessorKey: "status_label", header: header("Status"), meta: { label: "Status" }, cell: statusCell },
  text("justification", "Justification"),
  text("remarks", "Remarks / justification", { enableSorting: false, cell: ({ getValue }) => <span className="text-xs">{getValue() || ""}</span> }),
];

const KPI_TONES = { success: "text-success", warning: "text-warning", danger: "text-danger", info: "text-info" };

function Kpi({ label, value, sub, variant }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${KPI_TONES[variant] || ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export default function AttendanceReports() {
  const [params, setParams] = useSearchParams();
  const audience = params.get("audience") === "students" ? "students" : "lecturers";
  const [options, setOptions] = useState({ lecturers: [], students: [], batches: [], courses: [], semester: {} });
  const [q, setQ] = useState({
    period: "monthly",
    date: todayIso(),
    month: currentMonth(),
    from: "",
    to: "",
    lecturer_id: ALL,
    student_id: ALL,
    batch: ALL,
    course: ALL,
    view: "summary",
  });
  const [categories, setCategories] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    client.get("/admin/attendance-reports/options").then((res) => setOptions(res.data)).catch(() => {});
  }, []);

  const apiParams = useMemo(() => {
    const p = { period: q.period, view: q.view };
    if (q.period === "daily") p.date = q.date;
    if (q.period === "monthly") p.month = q.month;
    if (q.period === "range" || q.period === "semester") {
      if (q.from) p.from = q.from;
      if (q.to) p.to = q.to;
    }
    for (const k of ["lecturer_id", "batch", "course"]) if (q[k] !== ALL) p[k] = q[k];
    if (audience === "students" && q.student_id !== ALL) p.student_id = q.student_id;
    if (categories.length) p.category = categories.join(",");
    return p;
  }, [q, categories, audience]);

  const ready = q.period !== "range" || (q.from && q.to);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    setError("");
    client
      .get(`/admin/attendance-reports/${audience}`, { params: apiParams })
      .then((res) => setData(res.data))
      .catch((err) => {
        setError(apiErrorMessage(err));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [apiParams, audience, ready]);

  async function exportExcel() {
    setExporting(true);
    try {
      await downloadFile("/admin/attendance-reports/export", { ...apiParams, audience }, `${audience}-attendance.xlsx`);
      toast.success("Excel report downloaded");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Export failed"));
    } finally {
      setExporting(false);
    }
  }

  const set = (patch) => setQ((s) => ({ ...s, ...patch }));
  const columns =
    q.view === "summary" ? (audience === "lecturers" ? LECTURER_SUMMARY : STUDENT_SUMMARY) : audience === "lecturers" ? LECTURER_DETAIL : STUDENT_DETAIL;
  const t = data?.totals;
  const categoryChoices = Object.entries(CATEGORIES).filter(([k]) => (audience === "students" ? !["left_early", "no_checkout"].includes(k) : k !== "exempted"));

  return (
    <div className="space-y-6">
      <div className="hidden print:block">
        <p className="text-sm font-semibold text-primary">{SYSTEM_FULL_NAME}</p>
        <h1 className="text-xl font-bold">
          {PERIODS.find((p) => p.value === q.period)?.label} {audience === "lecturers" ? "lecturer" : "student"} attendance report ({q.view})
        </h1>
        <p className="text-sm">
          {data?.label} · {data?.scope} · generated {data?.generated_at?.replace("T", " ")}
        </p>
      </div>

      <div className="print:hidden">
        <PageHeader
          title="Attendance reports"
          description="Daily, monthly and semester attendance for lecturers and students. Summary or detailed, with Excel export."
          actions={
            <>
              <Button variant="outline" asChild>
                <Link to="/admin/attendance-rankings">
                  <Trophy /> Rankings
                </Link>
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> Print
              </Button>
              <Button onClick={exportExcel} disabled={exporting || !ready}>
                <FileSpreadsheet /> {exporting ? "Preparing..." : "Export Excel"}
              </Button>
            </>
          }
        />
      </div>

      <div className="space-y-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={audience} onValueChange={(v) => setParams({ audience: v })}>
            <TabsList>
              <TabsTrigger value="lecturers">Lecturers</TabsTrigger>
              <TabsTrigger value="students">Students</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={q.view} onValueChange={(v) => set({ view: v })}>
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="detailed">Detailed</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Period</Label>
            <Select value={q.period} onValueChange={(v) => set({ period: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {q.period === "daily" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input type="date" value={q.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
            </div>
          )}
          {q.period === "monthly" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Month</Label>
              <Input type="month" value={q.month} onChange={(e) => e.target.value && set({ month: e.target.value })} />
            </div>
          )}
          {(q.period === "range" || q.period === "semester") && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From{q.period === "semester" ? " (default: semester start)" : ""}</Label>
                <Input type="date" value={q.from} onChange={(e) => set({ from: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To{q.period === "semester" ? " (default: semester end)" : ""}</Label>
                <Input type="date" value={q.to} onChange={(e) => set({ to: e.target.value })} />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Lecturer</Label>
            <Select value={q.lecturer_id} onValueChange={(v) => set({ lecturer_id: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All lecturers</SelectItem>
                {options.lecturers.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {audience === "students" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Student</Label>
              <Select value={q.student_id} onValueChange={(v) => set({ student_id: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All students</SelectItem>
                  {options.students
                    .filter((s) => q.batch === ALL || s.batch === q.batch)
                    .map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} ({s.student_id_number || "no ID"})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Class</Label>
            <Select value={q.batch} onValueChange={(v) => set({ batch: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All classes</SelectItem>
                {options.batches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Course</Label>
            <Select value={q.course} onValueChange={(v) => set({ course: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All courses</SelectItem>
                {options.courses.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Show only:</span>
          {categoryChoices.map(([k, c]) => {
            const on = categories.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCategories((cs) => (on ? cs.filter((x) => x !== k) : [...cs, k]))}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                {c.label}
              </button>
            );
          })}
          {categories.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setCategories([])}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {!ready && <Alert variant="success">Choose a start and an end date.</Alert>}
      {error && <Alert>{error}</Alert>}

      {t && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Counted sessions" value={t.counted_sessions} sub={`${t.scheduled_sessions} scheduled`} />
          <Kpi label={audience === "lecturers" ? "Present (on time)" : "Present"} value={t.present} sub={pct(t.present_rate)} variant="success" />
          <Kpi label="Late" value={t.late} sub={pct(t.late_rate)} variant="warning" />
          <Kpi label="Absent (unjustified)" value={t.absent} sub={pct(t.absent_rate)} variant="danger" />
          <Kpi label="Justified absence" value={t.justified} sub={pct(t.justified_rate)} variant="info" />
          {audience === "students" ? (
            <Kpi label="Exempted (not counted)" value={t.exempted} sub="lecturer unavailable" />
          ) : (
            <Kpi label="Left early / no check-out" value={`${t.left_early} / ${t.no_checkout}`} sub={`attendance ${pct(t.attendance_rate)}`} />
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Percentages are of counted sessions: sessions that have taken place, excluding sessions exempted because the lecturer was
        recorded as unavailable. {data?.label && <strong>Period: {data.label}.</strong>}
      </p>
      {data?.truncated && (
        <Alert variant="success">
          Showing the first {data.rows.length} of {data.total_rows} rows. The Excel export contains every row.
        </Alert>
      )}

      <DataTable
        key={`${audience}-${q.view}`}
        columns={columns}
        data={data?.rows || []}
        loading={loading}
        getRowId={(r, i) => String(i)}
        searchPlaceholder={q.view === "summary" ? "Search names..." : "Search names, classes, courses..."}
        exportName={`${audience}-${q.view}`}
        emptyText="No records for this period and these filters."
        pageSize={q.view === "summary" ? 50 : 100}
        pageSizes={[20, 50, 100, 500]}
      />
    </div>
  );
}
