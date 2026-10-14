import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import ExportMenu from "@/components/ExportMenu.jsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SemesterBadge, useSemester } from "@/components/timetable/WeeklyTimetable.jsx";
import { cn } from "@/lib/utils";
import CourseCatalogue from "./CourseCatalogue.jsx";
import BatchWeek from "./BatchWeek.jsx";
import { BatchList, RoomList } from "./TimetableLists.jsx";
import { CourseSessions, TimetableClashes } from "@/components/timetable/CourseSessions.jsx";
import TimetableUpload from "@/components/timetable/TimetableUpload.jsx";
import { useAuth } from "@/context/AuthContext.jsx";

const DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const NONE = "__none";

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
  const { can } = useAuth();
  const canEdit = can("timetable:edit");
  const canDelete = can("timetable:delete");
  const [entries, setEntries] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState(null);
  const [tab, setTab] = useState("sessions");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [batches, setBatches] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [courseNames, setCourseNames] = useState([]);
  const [listsLoading, setListsLoading] = useState(true);
  const semester = useSemester();
  const [clashes, setClashes] = useState([]);
  const [periods, setPeriods] = useState({ periods: [], durations: [] });
  useEffect(() => {
    client.get("/admin/timetable/periods").then((r) => setPeriods(r.data)).catch(() => {});
  }, []);

  function load() {
    setLoading(true);
    Promise.all([client.get("/admin/timetable"), client.get("/admin/lecturers")])
      .then(([tt, lec]) => {
        setEntries(tt.data);
        setLecturers(lec.data);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
    loadLists();
  }

  // The lists the class form picks from: batches, rooms and course names.
  function loadLists() {
    setListsLoading(true);
    Promise.all([client.get("/admin/batches"), client.get("/admin/rooms"), client.get("/admin/course-catalogue")])
      .then(([b, r, c]) => {
        setBatches(b.data);
        setRooms(r.data);
        setCourseNames([...new Set(c.data.map((x) => x.name))].sort());
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setListsLoading(false));
  }

  useEffect(load, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function toggleDay(day) {
    setForm((f) => ({ ...f, days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day] }));
  }

  function openAdd() {
    setForm(emptyForm);
    setClashes([]);
    setFormError("");
    setFormOpen(true);
  }

  // Start a weekly-timetable row from a course in the course list.
  function openAddFromCourse(course) {
    setForm({
      ...emptyForm,
      lecturer_id: course.lecturer_id ? String(course.lecturer_id) : "",
      course_name: course.name,
      batch: course.batch || "",
    });
    setFormError("");
    setTab("sessions");
    setFormOpen(true);
  }

  function openEdit(entry) {
    setForm({
      id: entry.id,
      lecturer_id: entry.lecturer_id ? String(entry.lecturer_id) : "",
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
    setClashes([]);
    setFormError("");
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    const payload = { ...form, lecturer_id: form.lecturer_id ? Number(form.lecturer_id) : null };
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
      setClashes(err.response?.data?.clashes || []);
      setFormError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // "1.5", "2" ... hours after the start time, as HH:MM.
  function endAfter(start, hours) {
    if (!start) return "";
    const [hh, mm] = start.split(":").map(Number);
    const total = hh * 60 + mm + Math.round(Number(hours) * 60);
    if (total >= 24 * 60) return "";
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
        cell: ({ getValue }) =>
          getValue() ? <span className="font-medium">{getValue()}</span> : <Badge variant="warning">Not assigned</Badge>,
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
        cell: ({ row }) =>
          (canEdit || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onSelect={() => openEdit(row.original)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {canEdit && canDelete && <DropdownMenuSeparator />}
                {canDelete && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(row.original)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, canDelete]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="The semester's courses, who teaches them, and every recurring class by lecturer, batch and weekday."
        actions={
          <>
            <SemesterBadge name={semester?.semester_name} />
            <ExportMenu url="/admin/timetable/export" name="Timetable" />
            {can("timetable:add") && can("timetable:edit") && can("timetable:delete") && (
              <Button variant="outline" onClick={() => setUploadOpen(true)}>
                <FileSpreadsheet /> Upload Excel
              </Button>
            )}
            {can("timetable:add") && tab === "sessions" && (
              <Button onClick={openAdd}>
                <Plus /> Add class
              </Button>
            )}
          </>
        }
      />

      {error && <Alert>{error}</Alert>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="sessions">Weekly timetable</TabsTrigger>
          <TabsTrigger value="batch">By batch</TabsTrigger>
          <TabsTrigger value="courses">Courses & lecturers</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="progress">Sessions & completion</TabsTrigger>
          <TabsTrigger value="clashes">Clashes</TabsTrigger>
        </TabsList>
        <TabsContent value="progress">
          <CourseSessions batches={batches} />
        </TabsContent>
        <TabsContent value="clashes">
          <TimetableClashes key={entries.length} />
        </TabsContent>
        <TabsContent value="batch">
          <BatchWeek batches={batches} />
        </TabsContent>
        <TabsContent value="courses">
          <CourseCatalogue
            key={entries.length}
            lecturers={lecturers}
            batches={batches}
            semesterName={semester?.semester_name}
            onAddSessions={openAddFromCourse}
          />
        </TabsContent>
        <TabsContent value="batches">
          <BatchList rows={batches} loading={listsLoading} onChanged={load} />
        </TabsContent>
        <TabsContent value="rooms">
          <RoomList rows={rooms} loading={listsLoading} onChanged={load} />
        </TabsContent>
        <TabsContent value="sessions">
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
        </TabsContent>
      </Tabs>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit class" : "Add a class"}</DialogTitle>
              <DialogDescription>Days left empty default to Saturday–Thursday.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Lecturer">
                <Select value={form.lecturer_id || NONE} onValueChange={(v) => set({ lecturer_id: v === NONE ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select lecturer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not assigned yet</SelectItem>
                    {lecturers.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Course" hint={courseNames.length ? "Pick from Courses & lecturers or type a new one." : undefined}>
                <Input required list="tt-course-names" value={form.course_name} onChange={(e) => set({ course_name: e.target.value })} />
                <datalist id="tt-course-names">
                  {courseNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </Field>
              <Field label="Batch / class" hint={batches.length ? undefined : "Add batches in the Batches tab first."}>
                <Select value={form.batch || NONE} onValueChange={(v) => set({ batch: v === NONE ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select batch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No batch</SelectItem>
                    {[...batches.map((b) => b.code), ...(form.batch && !batches.some((b) => b.code === form.batch) ? [form.batch] : [])].map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Room" hint={rooms.length ? undefined : "Add rooms in the Rooms tab first."}>
                <Select value={form.room || NONE} onValueChange={(v) => set({ room: v === NONE ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select room" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No room</SelectItem>
                    {[...rooms.map((r) => r.name), ...(form.room && !rooms.some((r) => r.name === form.room) ? [form.room] : [])].map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {periods.periods.length > 0 && (
                <Field label="Period (quick choice)">
                  <Select
                    value={periods.periods.find((p) => p.start_time === form.start_time && p.end_time === form.end_time)?.label || NONE}
                    onValueChange={(v) => {
                      const p = periods.periods.find((x) => x.label === v);
                      if (p) set({ start_time: p.start_time, end_time: p.end_time });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Other time" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Other time</SelectItem>
                      {periods.periods.map((p) => (
                        <SelectItem key={p.label} value={p.label}>
                          {p.label}: {p.start_time}–{p.end_time}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Length">
                <Select
                  value={periods.durations.find((d) => endAfter(form.start_time, d) === form.end_time)?.toString() || NONE}
                  onValueChange={(v) => v !== NONE && set({ end_time: endAfter(form.start_time, v) })}
                  disabled={!form.start_time}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose the start time first" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Other (enter the end time)</SelectItem>
                    {periods.durations.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} hours
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            {clashes.length > 0 && (
              <label className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/5 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!form.confirm_combined}
                  onChange={(e) => set({ confirm_combined: e.target.checked })}
                />
                <span>
                  This is one combined class: the same lecturer teaches these classes together, in the same room. Save it anyway.
                </span>
              </label>
            )}

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

      <TimetableUpload open={uploadOpen} onOpenChange={setUploadOpen} onDone={load} />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this class?"
        description={toDelete ? `${toDelete.course_name} (${toDelete.lecturer_name || "not assigned"}) will be removed from the timetable.` : ""}
        confirmLabel="Delete"
        onConfirm={() => handleDelete(toDelete)}
      />
    </div>
  );
}
