import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const emptyForm = {
  id: null,
  lecturer_id: "",
  course_name: "",
  batch: "",
  room: "",
  days: [],
  start_time: "",
  end_time: "",
  sessions: 1,
  semester_total_sessions: "",
  note: "",
};

function Field({ label, hint, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function Timetable() {
  const [entries, setEntries] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState(null);

  function load() {
    setLoading(true);
    Promise.all([client.get("/admin/timetable"), client.get("/admin/lecturers")])
      .then(([tt, lec]) => {
        setEntries(tt.data);
        setLecturers(lec.data);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function toggleDay(day) {
    setForm((f) => ({ ...f, days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day] }));
  }

  function openAdd() {
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(entry) {
    setForm({
      id: entry.id,
      lecturer_id: String(entry.lecturer_id),
      course_name: entry.course_name,
      batch: entry.batch || "",
      room: entry.room || "",
      days: entry.days || [],
      start_time: entry.start_time || "",
      end_time: entry.end_time || "",
      sessions: entry.sessions,
      semester_total_sessions: entry.semester_total_sessions ?? "",
      note: entry.note || "",
    });
    setFormError("");
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.lecturer_id) {
      setFormError("Please select a lecturer.");
      return;
    }
    setFormError("");
    setSaving(true);
    const payload = { ...form, lecturer_id: Number(form.lecturer_id) };
    try {
      if (form.id) {
        await client.put(`/admin/timetable/${form.id}`, payload);
        toast.success("Class updated");
      } else {
        await client.post("/admin/timetable", payload);
        toast.success("Class added");
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setFormError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry) {
    try {
      await client.delete(`/admin/timetable/${entry.id}`);
      toast.success("Class deleted");
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: "lecturer_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lecturer" />,
        meta: { label: "Lecturer" },
        filterFn: "equalsString",
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      },
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course" />,
        meta: { label: "Course" },
      },
      {
        accessorKey: "batch",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        meta: { label: "Batch" },
        filterFn: "equalsString",
        cell: ({ getValue }) => getValue() || "—",
      },
      {
        accessorKey: "room",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Room" />,
        meta: { label: "Room" },
        cell: ({ getValue }) => getValue() || "—",
      },
      {
        id: "days",
        accessorFn: (r) => (r.days || []).join(", "),
        header: "Days",
        cell: ({ row }) =>
          row.original.days?.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.days.map((d) => (
                <Badge key={d} variant="secondary" className="px-1.5 text-[10px]">
                  {d}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">Sat–Thu</span>
          ),
      },
      {
        id: "time",
        accessorFn: (r) => `${r.start_time || "—"} - ${r.end_time || "—"}`,
        header: "Time",
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span>,
      },
      {
        id: "total",
        accessorFn: (r) => r.semester_total_sessions ?? "estimated",
        header: "Total / semester",
        cell: ({ getValue }) =>
          getValue() === "estimated" ? <span className="text-muted-foreground">estimated</span> : getValue(),
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openEdit(row.original)}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(row.original)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Every recurring class, by lecturer, batch and weekday."
        actions={
          <Button onClick={openAdd}>
            <Plus /> Add class
          </Button>
        }
      />

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={entries}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search lecturer, course, room..."
        filters={[
          { columnId: "lecturer_name", label: "Lecturer" },
          { columnId: "batch", label: "Batch" },
        ]}
        exportName="timetable"
        emptyText="No classes in the timetable yet."
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit class" : "Add a class"}</DialogTitle>
              <DialogDescription>Days left empty default to Saturday–Thursday.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Lecturer">
                <Select value={form.lecturer_id} onValueChange={(v) => set({ lecturer_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select lecturer" />
                  </SelectTrigger>
                  <SelectContent>
                    {lecturers.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Course">
                <Input required value={form.course_name} onChange={(e) => set({ course_name: e.target.value })} />
              </Field>
              <Field label="Batch / class (e.g. BCE08)">
                <Input value={form.batch} onChange={(e) => set({ batch: e.target.value })} />
              </Field>
              <Field label="Room">
                <Input value={form.room} onChange={(e) => set({ room: e.target.value })} />
              </Field>
              <Field label="Start time">
                <Input type="time" required value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} />
              </Field>
              <Field label="End time (optional)">
                <Input type="time" value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />
              </Field>
              <Field label="Sessions per meeting">
                <Input type="number" min={1} value={form.sessions} onChange={(e) => set({ sessions: e.target.value })} />
              </Field>
              <Field label="Total sessions this semester">
                <Input
                  type="number"
                  min={0}
                  placeholder="e.g. 34 — blank to estimate"
                  value={form.semester_total_sessions}
                  onChange={(e) => set({ semester_total_sessions: e.target.value })}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              "Total sessions this semester" is the real number of times this class meets all term (accounting for exam
              weeks/holidays). Students are blocked and flagged for retake once their absences reach 25% of it. Until
              you set it, it is estimated from the semester dates in Settings.
            </p>

            <Field label="Days">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((day) => {
                  const on = form.days.includes(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => toggleDay(day)}
                      aria-pressed={on}
                      className={cn(
                        "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Note">
              <Input value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>

            {formError && <Alert>{formError}</Alert>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : form.id ? "Save changes" : "Add class"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this class?"
        description={toDelete ? `${toDelete.course_name} (${toDelete.lecturer_name}) will be removed from the timetable.` : ""}
        confirmLabel="Delete"
        onConfirm={() => handleDelete(toDelete)}
      />
    </div>
  );
}
