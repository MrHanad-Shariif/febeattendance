import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/committees";
import { DeadlineBadge } from "@/pages/assignments/shared";
import { CompletionBar, PeriodStatusBadge, percentOf } from "./shared";

function ReportDialog({ row, periodId, onClose, onSaved }) {
  const [covered, setCovered] = useState(row.covered_chapters ?? "");
  const [planned, setPlanned] = useState(row.planned_chapters ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pct = percentOf(covered, planned);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await client.put("/course-completion/mine", {
        period_id: periodId,
        class_name: row.class_name,
        course_name: row.course_name,
        covered_chapters: covered,
        planned_chapters: planned,
      });
      toast.success("Report saved");
      onSaved(res.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{row.course_name}</DialogTitle>
            <DialogDescription>
              {row.semester} · Class {row.class_name} · {row.lecturer_name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Covered chapters" htmlFor="cc-covered">
              <Input id="cc-covered" type="number" min={0} max={500} inputMode="numeric" value={covered} onChange={(e) => setCovered(e.target.value)} required autoFocus />
            </Field>
            <Field label="Planned chapters" htmlFor="cc-planned">
              <Input id="cc-planned" type="number" min={1} max={500} inputMode="numeric" value={planned} onChange={(e) => setPlanned(e.target.value)} required />
            </Field>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1.5 text-xs text-muted-foreground">Completion / coverage (worked out for you)</p>
            <CompletionBar value={pct} />
          </div>
          {error && <Alert>{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || pct == null}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function LecturerCompletion() {
  const { data, setData, loading, error } = useApi("/course-completion/mine", null);
  const [editing, setEditing] = useState(null);

  if (loading && !data) return <Skeleton className="h-96 w-full" />;
  const period = data?.period;
  const rows = data?.rows || [];
  const done = rows.filter((r) => r.completion_percent != null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Course completion report"
        description="For each course you teach, report the chapters covered against the chapters planned."
      />
      {error && <Alert>{error}</Alert>}

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {period ? period.semester : "No report period yet"}
              {period && <PeriodStatusBadge status={data.can_submit ? "open" : period.status} />}
              {data?.reopened && data.can_submit && <Badge variant="info">Reopened for you</Badge>}
            </CardTitle>
            <CardDescription>
              {period
                ? `Opens ${formatDateTime(period.opens_at)} · Deadline ${formatDateTime(data.deadline)}`
                : "The admin opens the report for each semester."}
            </CardDescription>
          </div>
          {data?.can_submit && <DeadlineBadge iso={data.deadline} />}
        </CardHeader>
        {period && (
          <CardContent className="space-y-3">
            {data.message && (
              <div className="flex items-start gap-3 rounded-lg border border-muted-foreground/20 bg-muted/40 p-3 text-sm">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>{data.message}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {done} of {rows.length} course{rows.length === 1 ? "" : "s"} submitted.
            </p>
          </CardContent>
        )}
      </Card>

      {period && (
        <Card>
          {rows.length === 0 ? (
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No courses are assigned to you this semester.</p>
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Semester</TableHead>
                    <TableHead>Class Name</TableHead>
                    <TableHead>Lecturer Name</TableHead>
                    <TableHead>Course Name</TableHead>
                    <TableHead className="text-right">Covered Chapters</TableHead>
                    <TableHead className="text-right">Planned Chapters</TableHead>
                    <TableHead>Completion %</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.class_name}|${r.course_name}`}>
                      <TableCell className="whitespace-nowrap">{r.semester}</TableCell>
                      <TableCell className="font-medium">{r.class_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.lecturer_name}</TableCell>
                      <TableCell>{r.course_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.covered_chapters ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.planned_chapters ?? "—"}</TableCell>
                      <TableCell>
                        <CompletionBar value={r.completion_percent} />
                      </TableCell>
                      <TableCell className="text-right">
                        {data.can_submit && (
                          <Button size="sm" variant={r.completion_percent == null ? "default" : "outline"} onClick={() => setEditing(r)}>
                            {r.completion_percent == null ? <Plus /> : <Pencil />}
                            {r.completion_percent == null ? "Add" : "Edit"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {editing && (
        <ReportDialog
          row={editing}
          periodId={period.id}
          onClose={() => setEditing(null)}
          onSaved={(view) => {
            setData(view);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Dashboard reminder: shown to lecturers while the report is open for them. */
export function CompletionReminder() {
  const { data } = useApi("/course-completion/mine", null);
  if (!data?.can_submit || !data.rows?.length) return null;
  const left = data.rows.filter((r) => r.completion_percent == null).length;
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Course completion report – {data.period.semester}</p>
            <p className="text-sm text-muted-foreground">
              {left ? `${left} of ${data.rows.length} course(s) still to report.` : "All your courses are reported; you can still edit them."} Deadline{" "}
              {formatDateTime(data.deadline)}.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant={left ? "default" : "outline"}>
          <Link to="/course-completion">{left ? "Submit now" : "Review"}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
