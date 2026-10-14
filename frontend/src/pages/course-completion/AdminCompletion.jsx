import { useMemo, useState } from "react";
import { CalendarClock, FileSpreadsheet, Lock, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, OptionSelect, useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import ExportMenu from "@/components/ExportMenu.jsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadFromApi, formatDateTime, toLocalInput } from "@/lib/committees";
import { CompletionBar, PeriodStatusBadge, endOfDayAfter, localInput } from "./shared";

function DeadlinePresets({ from, onPick }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      Deadline after
      {[3, 4, 5].map((d) => (
        <Button key={d} type="button" size="sm" variant="outline" className="h-7" onClick={() => onPick(endOfDayAfter(d, from))}>
          {d} days
        </Button>
      ))}
    </div>
  );
}

function PeriodDialog({ period, currentSemester, onClose, onSaved }) {
  const [form, setForm] = useState(
    period
      ? { semester: period.semester, opens_at: toLocalInput(period.opens_at), closes_at: toLocalInput(period.closes_at) }
      : { semester: currentSemester, opens_at: localInput(new Date()), closes_at: endOfDayAfter(5) }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = period
        ? await client.put(`/course-completion/periods/${period.id}`, form)
        : await client.post("/course-completion/periods", form);
      toast.success(period ? "Dates updated" : "Report period opened. Lecturers have been notified.");
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
            <DialogTitle>{period ? "Change report dates" : "Open course completion report"}</DialogTitle>
            <DialogDescription>Lecturers can add and edit their reports from the start date until the deadline.</DialogDescription>
          </DialogHeader>
          <Field label="Semester" htmlFor="cp-sem" hint={period ? undefined : "Defaults to the current semester in Settings."}>
            <Input id="cp-sem" value={form.semester} onChange={set("semester")} maxLength={100} disabled={!!period} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="cp-open">
              <Input id="cp-open" type="datetime-local" value={form.opens_at} onChange={set("opens_at")} required />
            </Field>
            <Field label="Deadline" htmlFor="cp-close">
              <Input id="cp-close" type="datetime-local" value={form.closes_at} onChange={set("closes_at")} required />
            </Field>
          </div>
          <DeadlinePresets from={form.opens_at} onPick={(v) => setForm((f) => ({ ...f, closes_at: v }))} />
          {error && <Alert>{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : period ? "Save" : "Open report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ period, lecturers, onClose, onSaved }) {
  const [selected, setSelected] = useState([]);
  const [until, setUntil] = useState(endOfDayAfter(3));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const shown = lecturers.filter((l) => l.name.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await client.post(`/course-completion/periods/${period.id}/reopen`, { lecturer_ids: selected, until });
      toast.success(`Reopened for ${selected.length} lecturer(s). They have been notified.`);
      onSaved(res.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reopen for lecturers</DialogTitle>
            <DialogDescription>The chosen lecturers can add or edit their {period.semester} reports until the date below.</DialogDescription>
          </DialogHeader>
          <Field label="Open until" htmlFor="ro-until">
            <Input id="ro-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} required />
          </Field>
          <DeadlinePresets onPick={setUntil} />
          <Field label={`Lecturers (${selected.length} chosen)`} htmlFor="ro-search">
            <Input id="ro-search" placeholder="Search lecturers..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
              {shown.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={selected.includes(l.id)} onCheckedChange={() => toggle(l.id)} />
                  {l.name}
                </label>
              ))}
              {shown.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No lecturers match.</p>}
            </div>
          </Field>
          {error && <Alert>{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !selected.length}>
              {saving ? "Saving..." : "Reopen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PeriodCard({ meta, period, onChanged }) {
  const [dialog, setDialog] = useState(null); // "new" | "edit" | "reopen" | "close"
  const canEdit = meta.can_edit;

  async function act(fn, message) {
    try {
      await fn();
      toast.success(message);
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const reopenings = period?.reopenings || [];
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" /> Submission period
            {period && <PeriodStatusBadge status={period.status} />}
          </CardTitle>
          <CardDescription>
            {period
              ? `${period.semester}: ${formatDateTime(period.opens_at)} – ${formatDateTime(period.closes_at)} · ${period.report_count} report(s)`
              : `Not opened for this semester yet. Lecturers can't submit until you open it.`}
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {period ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
                  <Pencil /> Change dates
                </Button>
                {period.status === "closed" ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog("reopen")}>
                    <RotateCcw /> Reopen for lecturers
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setDialog("close")}>
                    <Lock /> Close now
                  </Button>
                )}
              </>
            ) : (
              <Button size="sm" onClick={() => setDialog("new")}>
                <Plus /> Open report
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      {reopenings.length > 0 && (
        <CardContent>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Reopened for</p>
          <div className="flex flex-wrap gap-2">
            {reopenings.map((r) => (
              <Badge key={r.lecturer_id} variant={r.active ? "info" : "muted"} className="gap-1.5 py-1">
                {r.lecturer_name} · until {formatDateTime(r.until)}
                {canEdit && r.active && (
                  <button
                    type="button"
                    aria-label={`Withdraw ${r.lecturer_name}'s reopening`}
                    onClick={() => act(() => client.delete(`/course-completion/periods/${period.id}/reopen/${r.lecturer_id}`), "Reopening withdrawn")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        </CardContent>
      )}
      {(dialog === "new" || dialog === "edit") && (
        <PeriodDialog
          period={dialog === "edit" ? period : null}
          currentSemester={meta.semester}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog === "reopen" && (
        <ReopenDialog
          period={period}
          lecturers={meta.lecturers}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Close submissions now?"
        description="Lecturers will no longer be able to add or edit reports, including anyone it was reopened for."
        confirmLabel="Close now"
        onConfirm={() => act(() => client.post(`/course-completion/periods/${period.id}/close`), "Submissions closed")}
      />
    </Card>
  );
}

export default function AdminCompletion() {
  const periods = useApi("/course-completion/periods", null);
  const [semester, setSemester] = useState("");
  const [className, setClassName] = useState("");
  const [downloading, setDownloading] = useState("");

  const activeSemester = semester || periods.data?.current_semester || "";
  const query = new URLSearchParams({ semester: activeSemester, ...(className ? { class_name: className } : {}) }).toString();
  const reports = useApi(activeSemester ? `/course-completion/reports?${query}` : null, null);
  const period = (periods.data?.periods || []).find((p) => p.semester === activeSemester);
  const rows = reports.data?.rows || [];
  const submitted = rows.filter((r) => r.submitted).length;

  async function download(byClass) {
    setDownloading(byClass ? "class" : "all");
    const params = new URLSearchParams({ semester: activeSemester, ...(byClass ? { class_name: className } : {}) });
    const today = new Date().toISOString().slice(0, 10);
    const slug = (t) => t.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      await downloadFromApi(
        `/course-completion/export.xlsx?${params}`,
        `course-completion-${slug(activeSemester)}-${byClass ? slug(className) : "all"}-${today}.xlsx`
      );
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setDownloading("");
    }
  }

  const columns = useMemo(
    () => [
      { accessorKey: "semester", header: "Semester", meta: { label: "Semester" } },
      {
        accessorKey: "class_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Class Name" />,
        meta: { label: "Class Name" },
        cell: ({ row }) => <span className="font-medium">{row.original.class_name}</span>,
      },
      {
        accessorKey: "lecturer_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lecturer Name" />,
        meta: { label: "Lecturer Name" },
      },
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course Name" />,
        meta: { label: "Course Name" },
      },
      {
        accessorKey: "covered_chapters",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Covered Chapters" />,
        meta: { label: "Covered Chapters" },
        cell: ({ row }) => row.original.covered_chapters ?? "—",
      },
      {
        accessorKey: "planned_chapters",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Planned Chapters" />,
        meta: { label: "Planned Chapters" },
        cell: ({ row }) => row.original.planned_chapters ?? "—",
      },
      {
        accessorKey: "completion_percent",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Completion %" />,
        meta: { label: "Completion %" },
        sortUndefined: "last",
        cell: ({ row }) =>
          row.original.submitted ? <CompletionBar value={row.original.completion_percent} /> : <Badge variant="warning">Not submitted</Badge>,
      },
      {
        id: "status",
        accessorFn: (r) => (r.submitted ? "submitted" : "missing"),
        header: "Status",
        meta: { label: "Status" },
        filterFn: "equalsString",
        enableHiding: true,
      },
    ],
    []
  );

  if (periods.loading && !periods.data) return <Skeleton className="h-96 w-full" />;

  const semesterOptions = (reports.data?.semesters || [activeSemester]).filter(Boolean).map((s) => ({ value: s, label: s }));
  const classOptions = (reports.data?.classes || []).map((c) => ({ value: c, label: c }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Course completion report"
        description="Chapters covered against chapters planned, per course, class and lecturer."
        actions={
          <>
            <Button variant="outline" onClick={() => download(!!className)} disabled={!activeSemester || !!downloading} title="The raw data sheet, one row per submitted report">
              <FileSpreadsheet /> {downloading ? "Preparing..." : "Raw data (.xlsx)"}
            </Button>
            <ExportMenu
              url="/course-completion/export"
              params={{ semester: activeSemester, ...(className ? { class_name: className } : {}) }}
              name="Course_Completion"
              label={className ? `Download ${className}` : "Download all classes"}
              disabled={!activeSemester}
            />
          </>
        }
      />
      {periods.error && <Alert>{periods.error}</Alert>}
      {periods.data && (
        <PeriodCard
          meta={{ ...periods.data, semester: periods.data.current_semester }}
          period={period}
          onChanged={() => {
            periods.reload();
            reports.reload();
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Semester" htmlFor="cc-semester">
          <OptionSelect
            id="cc-semester"
            value={activeSemester}
            onChange={(v) => {
              setSemester(v);
              setClassName("");
            }}
            options={semesterOptions}
            className="w-64"
          />
        </Field>
        <Field label="Class" htmlFor="cc-class">
          <OptionSelect id="cc-class" value={className} onChange={setClassName} options={classOptions} anyLabel="All classes" className="w-48" />
        </Field>
        {reports.data && (
          <p className="pb-2 text-sm text-muted-foreground">
            {submitted} of {rows.length} course{rows.length === 1 ? "" : "s"} submitted
          </p>
        )}
      </div>

      {reports.error && <Alert>{reports.error}</Alert>}
      <DataTable
        columns={columns}
        data={rows}
        loading={reports.loading}
        getRowId={(r) => `${r.class_name}|${r.course_name}|${r.lecturer_id}`}
        searchPlaceholder="Search lecturer or course..."
        filters={[
          {
            columnId: "status",
            label: "Status",
            options: [
              { value: "submitted", label: "Submitted" },
              { value: "missing", label: "Not submitted" },
            ],
          },
        ]}
        initialVisibility={{ status: false }}
        emptyText={className ? `No courses found for ${className}.` : "No reports for this semester yet."}
      />
    </div>
  );
}
