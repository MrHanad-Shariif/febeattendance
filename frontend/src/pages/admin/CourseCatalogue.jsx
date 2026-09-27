import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext.jsx";

const UNASSIGNED = "__none";

const emptyForm = (semester) => ({
  id: null,
  code: "",
  name: "",
  batch: "",
  department: "",
  credit_hours: "",
  semester: semester || "",
  lecturer_id: "",
  note: "",
});

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Admin: the courses offered this semester and the lecturer assigned to each.
 * `onAddSessions(course)` opens the weekly-timetable form pre-filled from it.
 */
export default function CourseCatalogue({ lecturers, semesterName, onAddSessions, onChanged }) {
  const { can } = useAuth();
  const canAdd = can("timetable:add");
  const canEdit = can("timetable:edit");
  const canDelete = can("timetable:delete");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm(semesterName));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toDelete, setToDelete] = useState(null);

  function load() {
    setLoading(true);
    client
      .get("/admin/course-catalogue")
      .then((res) => setCourses(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setForm(emptyForm(semesterName));
    setFormError("");
    setOpen(true);
  }

  function openEdit(c) {
    setForm({
      id: c.id,
      code: c.code || "",
      name: c.name,
      batch: c.batch || "",
      department: c.department || "",
      credit_hours: c.credit_hours ?? "",
      semester: c.semester || "",
      lecturer_id: c.lecturer_id ? String(c.lecturer_id) : "",
      note: c.note || "",
    });
    setFormError("");
    setOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    const payload = { ...form, lecturer_id: form.lecturer_id ? Number(form.lecturer_id) : null };
    try {
      if (form.id) {
        await client.put(`/admin/course-catalogue/${form.id}`, payload);
        toast.success("Course updated");
      } else {
        await client.post("/admin/course-catalogue", payload);
        toast.success("Course added");
      }
      setOpen(false);
      load();
      onChanged?.();
    } catch (err) {
      setFormError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(c) {
    try {
      await client.delete(`/admin/course-catalogue/${c.id}`);
      toast.success("Course deleted");
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        meta: { label: "Code" },
        cell: ({ getValue }) => <span className="font-medium">{getValue() || "—"}</span>,
      },
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course" />,
        meta: { label: "Course" },
      },
      {
        accessorKey: "batch",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        meta: { label: "Batch" },
        filterFn: exactFilter,
        cell: ({ getValue }) => getValue() || "—",
      },
      {
        accessorKey: "lecturer_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lecturer" />,
        meta: { label: "Lecturer" },
        filterFn: exactFilter,
        cell: ({ getValue }) => getValue() || <Badge variant="warning">Not assigned</Badge>,
      },
      {
        accessorKey: "credit_hours",
        header: "Credit hours",
        meta: { label: "Credit hours" },
        cell: ({ getValue }) => getValue() ?? "—",
      },
      {
        accessorKey: "timetable_sessions",
        header: "In timetable",
        meta: { label: "In timetable" },
        cell: ({ getValue }) =>
          getValue() ? <Badge variant="success">{getValue()} row(s)</Badge> : <Badge variant="muted">Not scheduled</Badge>,
      },
      {
        accessorKey: "semester",
        header: "Semester",
        meta: { label: "Semester" },
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() || "—"}</span>,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) =>
          (canEdit || canDelete || canAdd) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canAdd && row.original.lecturer_id && (
                  <DropdownMenuItem onSelect={() => onAddSessions(row.original)}>
                    <Plus /> Add to weekly timetable
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onSelect={() => openEdit(row.original)}>
                    <Pencil /> Edit / assign lecturer
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(row.original)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canAdd, canEdit, canDelete]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The courses offered in {semesterName || "this semester"} and the lecturer assigned to teach each one. Lecturers
          see their assigned courses on their own timetable page.
        </p>
        {canAdd && (
          <Button onClick={openAdd}>
            <Plus /> Add course
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={courses}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search code, course, lecturer..."
        filters={[
          { columnId: "batch", label: "Batch" },
          { columnId: "lecturer_name", label: "Lecturer" },
        ]}
        exportName="courses"
        emptyText="No courses yet. Add the semester's courses and assign a lecturer to each."
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit course" : "Add a course"}</DialogTitle>
              <DialogDescription>Assign the lecturer who teaches this course to this batch.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Course code">
                <Input value={form.code} maxLength={30} placeholder="e.g. CE301" onChange={(e) => set({ code: e.target.value })} />
              </Field>
              <Field label="Course name">
                <Input required value={form.name} maxLength={255} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Batch / class (e.g. BCE08)">
                <Input value={form.batch} maxLength={50} onChange={(e) => set({ batch: e.target.value })} />
              </Field>
              <Field label="Lecturer">
                <Select value={form.lecturer_id || UNASSIGNED} onValueChange={(v) => set({ lecturer_id: v === UNASSIGNED ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select lecturer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Not assigned yet</SelectItem>
                    {lecturers.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Department">
                <Input value={form.department} maxLength={150} onChange={(e) => set({ department: e.target.value })} />
              </Field>
              <Field label="Credit hours">
                <Input type="number" min={0} max={30} value={form.credit_hours} onChange={(e) => set({ credit_hours: e.target.value })} />
              </Field>
              <Field label="Semester">
                <Input value={form.semester} maxLength={100} onChange={(e) => set({ semester: e.target.value })} />
              </Field>
              <Field label="Note">
                <Input value={form.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} />
              </Field>
            </div>
            {formError && <Alert>{formError}</Alert>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : form.id ? "Save changes" : "Add course"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this course?"
        description={toDelete ? `${toDelete.name} will be removed from the course list. Its weekly timetable rows are kept.` : ""}
        confirmLabel="Delete"
        onConfirm={() => remove(toDelete)}
      />
    </div>
  );
}
