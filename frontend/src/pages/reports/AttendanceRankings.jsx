import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Award, Clock, FileSpreadsheet, Medal, Printer, UserX } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SYSTEM_FULL_NAME } from "@/lib/committees";
import { currentMonth, downloadFile, pct } from "@/lib/attendance";

const MEDALS = ["text-yellow-500", "text-gray-400", "text-amber-700"];

function RankList({ title, description, icon: Icon, items, metric, empty }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ol className="space-y-2">
            {items.map((r) => (
              <li key={r.lecturer_id ?? r.student_id} className="flex items-start gap-3 rounded-lg border p-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">{r.rank}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.lecturer_name || r.student_name}
                    {r.student_id_number && <span className="ml-1 text-xs text-muted-foreground">{r.student_id_number}</span>}
                    {r.tied && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Tie
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{metric(r)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default function AttendanceRankings() {
  const [q, setQ] = useState({ period: "semester", month: currentMonth(), from: "", to: "", min_sessions: "5", late_threshold: "3" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const params = useMemo(() => {
    const p = { period: q.period, min_sessions: q.min_sessions || 5, late_threshold: q.late_threshold || 3 };
    if (q.period === "monthly") p.month = q.month;
    if (q.from) p.from = q.from;
    if (q.to) p.to = q.to;
    return p;
  }, [q]);
  const ready = q.period !== "range" || (q.from && q.to);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    setError("");
    client
      .get("/admin/attendance-reports/rankings", { params })
      .then((res) => setData(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [params, ready]);

  async function exportExcel() {
    setExporting(true);
    try {
      await downloadFile("/admin/attendance-reports/export", { ...params, audience: "rankings" }, "attendance-rankings.xlsx");
      toast.success("Rankings downloaded");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Export failed"));
    } finally {
      setExporting(false);
    }
  }

  const set = (patch) => setQ((s) => ({ ...s, ...patch }));
  const lr = data?.lecturers;
  const sr = data?.students;

  const warningColumns = useMemo(
    () => [
      { accessorKey: "student_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Student" />, meta: { label: "Student" } },
      { accessorKey: "student_id_number", header: "ID number", meta: { label: "ID number" } },
      { accessorKey: "class_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Class" />, meta: { label: "Class" }, filterFn: "equalsString" },
      { accessorKey: "course_name", header: "Course", meta: { label: "Course" } },
      { accessorKey: "effective_absences", header: ({ column }) => <DataTableColumnHeader column={column} title="Absences" />, meta: { label: "Effective absences" } },
      { accessorKey: "total_sessions", header: "Planned", meta: { label: "Planned sessions" } },
      {
        accessorKey: "absence_percentage",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Absence %" />,
        meta: { label: "Absence %" },
        cell: ({ getValue }) => `${getValue()}%`,
      },
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

  return (
    <div className="space-y-6">
      <div className="hidden print:block">
        <p className="text-sm font-semibold text-primary">{SYSTEM_FULL_NAME}</p>
        <h1 className="text-xl font-bold">Attendance rankings: {data?.label}</h1>
      </div>
      <div className="print:hidden">
        <PageHeader
          title="Attendance rankings"
          description="Best and most-absent lecturers, and students who need follow-up, from actual records against scheduled sessions."
          actions={
            <>
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

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 print:hidden">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Period</Label>
          <Select value={q.period} onValueChange={(v) => set({ period: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="semester">Semester</SelectItem>
              <SelectItem value="range">Date range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {q.period === "monthly" ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Month</Label>
            <Input type="month" value={q.month} onChange={(e) => e.target.value && set({ month: e.target.value })} />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={q.from} onChange={(e) => set({ from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={q.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Minimum sessions to rank</Label>
          <Input type="number" min={1} value={q.min_sessions} onChange={(e) => set({ min_sessions: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Repeated lateness from</Label>
          <Input type="number" min={1} value={q.late_threshold} onChange={(e) => set({ late_threshold: e.target.value })} />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {loading && !data && <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>}

      {lr && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Lecturers · {data.label}</h2>
            <p className="text-xs text-muted-foreground">
              {lr.method} Justified absences are never a penalty. Lecturers with fewer than {lr.min_sessions} accountable sessions are
              not ranked ({lr.insufficient_data.length} with insufficient data).
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              {lr.top.length === 0 && <p className="text-sm text-muted-foreground">Not enough data to rank lecturers in this period.</p>}
              {lr.top.map((r) => (
                <Card key={r.lecturer_id} className="relative overflow-hidden">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2">
                      <Medal className={`h-6 w-6 ${MEDALS[r.rank - 1] || "text-muted-foreground"}`} />
                      <span className="text-sm font-semibold text-muted-foreground">
                        #{r.rank}
                        {r.tied ? " (tie)" : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-bold">{r.lecturer_name}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-md bg-success/10 p-2">
                        <p className="text-base font-bold text-success">{pct(r.on_time_rate)}</p>on time
                      </div>
                      <div className="rounded-md bg-danger/10 p-2">
                        <p className="text-base font-bold text-danger">{pct(r.unjustified_absence_rate)}</p>unjust. absent
                      </div>
                      <div className="rounded-md bg-warning/10 p-2">
                        <p className="text-base font-bold text-warning">{pct(r.late_rate)}</p>late
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {r.accountable_sessions} accountable of {r.scheduled_sessions} scheduled sessions · {r.justified_absences} justified absence(s)
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <RankList
                title="Highest absence rate"
                description="Unjustified absences per accountable session."
                icon={UserX}
                items={lr.highest_absence_rate}
                metric={(r) => `${pct(r.unjustified_absence_rate)} · ${r.unjustified_absences} of ${r.accountable_sessions} sessions`}
                empty="No unjustified absences."
              />
              <RankList
                title="Most unjustified absences"
                icon={AlertTriangle}
                items={lr.most_unjustified_absences}
                metric={(r) => `${r.unjustified_absences} unjustified · ${r.justified_absences} justified (not counted)`}
                empty="No unjustified absences."
              />
              <RankList
                title="Most late arrivals"
                icon={Clock}
                items={lr.most_late}
                metric={(r) => `${r.late} late · ${pct(r.late_rate)} of sessions`}
                empty="No late arrivals."
              />
            </div>
            {lr.insufficient_data.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Insufficient data: {lr.insufficient_data.map((r) => `${r.lecturer_name} (${r.accountable_sessions})`).join(", ")}
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Students · {data.label}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <RankList
                title="Repeated lateness"
                description={`Late ${sr.late_threshold} or more times in this period.`}
                icon={Clock}
                items={sr.repeated_lateness}
                metric={(r) => `${r.student_class || "—"} · ${r.late} late of ${r.counted_sessions} sessions (${pct(r.late_rate)})`}
                empty="No student was repeatedly late."
              />
              <RankList
                title="Frequent absences"
                description={`Highest unjustified absence rate (at least ${sr.min_sessions} counted sessions).`}
                icon={UserX}
                items={sr.frequent_absences}
                metric={(r) => `${r.student_class || "—"} · ${r.absent} absent of ${r.counted_sessions} (${pct(r.absent_rate)}) · ${r.exempted} exempted`}
                empty="No unjustified student absences."
              />
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Award className="h-4 w-4 text-primary" /> Students requiring warnings
                </CardTitle>
                <CardDescription>
                  Semester standing per course: a warning from {data.warnings.warning_percent}% of planned sessions missed; at{" "}
                  {data.warnings.threshold_percent}% the course must be retaken. Exempted sessions are not counted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={warningColumns}
                  data={data.warnings.rows}
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
          </section>
        </>
      )}
    </div>
  );
}
