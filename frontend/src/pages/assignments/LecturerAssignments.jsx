import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NotebookPen, Plus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, OptionSelect, useApi } from "@/components/committees/shared";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, toFormData } from "@/lib/committees";
import { DeadlineBadge, defaultDeadline } from "./shared";

function NewAssignmentDialog({ open, onOpenChange, onSaved }) {
  const classes = useApi(open ? "/assignments/my-classes" : null, []);
  const [form, setForm] = useState({});
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ deadline: defaultDeadline() });
      setFile(null);
    }
  }, [open]);

  const options = (classes.data || []).map((c, i) => ({ value: String(i), label: `${c.course_name} — ${c.batch}` }));
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    const cls = (classes.data || [])[Number(form.cls)];
    if (!cls) return toast.error("Choose the class this assignment is for");
    setSaving(true);
    try {
      const res = await client.post(
        "/assignments",
        toFormData({ course_name: cls.course_name, batch: cls.batch, title: form.title, instructions: form.instructions, deadline: form.deadline, file })
      );
      toast.success("Assignment set. The class has been notified.");
      onOpenChange(false);
      onSaved(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <NotebookPen className="h-5 w-5 text-primary" /> New assignment
            </DialogTitle>
            <DialogDescription>
              Students of the class can attach files of any type until the deadline. After it, submissions close
              automatically; you can extend the deadline for everyone or give individual students extra time.
            </DialogDescription>
          </DialogHeader>
          <Field label="Class" htmlFor="as-class" hint={options.length === 0 && !classes.loading ? "You have no classes in the timetable or course list yet." : undefined}>
            <OptionSelect id="as-class" value={form.cls} onChange={set("cls")} placeholder="Choose course and batch" options={options} />
          </Field>
          <Field label="Title" htmlFor="as-title">
            <Input id="as-title" required maxLength={255} value={form.title || ""} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <Field label="Instructions" htmlFor="as-instructions">
            <Textarea id="as-instructions" rows={5} maxLength={20000} value={form.instructions || ""} onChange={(e) => set("instructions")(e.target.value)} />
          </Field>
          <Field label="Deadline" htmlFor="as-deadline" hint="Date and time; submissions close exactly then.">
            <Input id="as-deadline" type="datetime-local" required value={form.deadline || ""} onChange={(e) => set("deadline")(e.target.value)} />
          </Field>
          <Field label="Assignment brief (optional)" htmlFor="as-file" hint="Any file type, up to 15 MB.">
            <Input
              id="as-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Set assignment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function LecturerAssignments() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi("/assignments", []);
  const [open, setOpen] = useState(false);

  const columns = useMemo(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Assignment" />,
        meta: { label: "Assignment" },
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course" />,
        meta: { label: "Course" },
        filterFn: exactFilter,
      },
      {
        accessorKey: "batch",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        meta: { label: "Batch" },
        filterFn: exactFilter,
      },
      {
        accessorKey: "deadline",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Deadline" />,
        meta: { label: "Deadline", exportValue: (r) => formatDateTime(r.deadline) },
        cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.deadline)}</span>,
      },
      {
        id: "state",
        accessorFn: (r) => (r.open ? "Open" : "Closed"),
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <DeadlineBadge iso={row.original.deadline} />,
      },
      {
        id: "submitted",
        accessorFn: (r) => `${r.submitted_count}/${r.student_count}`,
        header: "Submitted",
        meta: { label: "Submitted" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            <strong>{row.original.submitted_count}</strong> / {row.original.student_count}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assignments"
        description="Set work for your classes, collect submissions and comment on them."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New assignment
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <DataTable
        columns={columns}
        data={data || []}
        loading={loading}
        getRowId={(r) => String(r.id)}
        onRowClick={(r) => navigate(`/assignments/${r.id}`)}
        searchPlaceholder="Search assignment, course, batch..."
        filters={[
          { columnId: "course_name", label: "Course" },
          { columnId: "batch", label: "Batch" },
        ]}
        exportName="assignments"
        emptyText="No assignments yet."
      />
      <NewAssignmentDialog open={open} onOpenChange={setOpen} onSaved={(a) => (reload(), navigate(`/assignments/${a.id}`))} />
    </div>
  );
}
