import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRightLeft, Ban, CheckCircle2, FileText, MoreHorizontal, Pencil, ScanFace, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge from "@/components/StatusBadge.jsx";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { AuthImage } from "@/components/auth-image";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { initials } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileRequestsAdmin from "@/components/ProfileRequestsAdmin.jsx";
import { useAuth } from "@/context/AuthContext.jsx";

const EDIT_FIELDS = [
  ["name", "Full name"],
  ["student_id_number", "Student ID"],
  ["email", "Email address"],
  ["phone", "Phone number"],
  ["program", "Program"],
  ["study_semester", "Semester (1-12)"],
];

/** Correct a student's record. Every change is kept in the profile history. */
function EditStudentDialog({ student, onClose, onSaved }) {
  const [form, setForm] = useState(() => Object.fromEntries([...EDIT_FIELDS.map(([k]) => [k, student[k] || ""]), ["department", student.department || ""]]));
  const [departments, setDepartments] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    client.get("/admin/departments").then((r) => setDepartments(r.data)).catch(() => {});
    client.get(`/admin/students/${student.id}/profile-history`).then((r) => setHistory(r.data)).catch(() => {});
  }, [student.id]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([k, v]) => (student[k] || "") !== v));
      await client.put(`/admin/students/${student.id}`, body);
      toast.success("Student record updated");
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit details: {student.name}</DialogTitle>
            <DialogDescription>Corrections are saved straight away and recorded in the student's profile history. To change the class, use Correct class.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {EDIT_FIELDS.map(([k, label]) => (
              <div key={k} className="space-y-1.5">
                <Label>{label}</Label>
                <Input type={k === "email" ? "email" : "text"} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={form.department || undefined} onValueChange={(v) => setForm((f) => ({ ...f, department: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose..." />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <Alert>{error}</Alert>}
          {history.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
              <p className="font-medium">Profile history</p>
              {history.map((h) => (
                <p key={h.id} className="text-muted-foreground">
                  {new Date(h.changed_at).toLocaleString()}: {h.field_label} {h.old_value || "—"} → {h.new_value || "—"} by {h.changed_by_name} ({h.source})
                </p>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Students() {
  const { can } = useAuth();
  const canEdit = can("students:edit");
  const canDelete = can("students:delete");
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [toResetFace, setToResetFace] = useState(null);
  const [toMove, setToMove] = useState(null);
  const [batches, setBatches] = useState([]);
  const [move, setMove] = useState({ batch: "", reason: "" });
  const [moveHistory, setMoveHistory] = useState([]);
  const [moving, setMoving] = useState(false);
  const [params, setParams] = useSearchParams();
  const [editingStudent, setEditingStudent] = useState(null);
  const tab = params.get("tab") === "requests" ? "requests" : "students";
  const [pendingRequests, setPendingRequests] = useState(0);
  const loadPending = () => client.get("/admin/profile-requests", { params: { status: "pending" } }).then((r) => setPendingRequests(r.data.pending)).catch(() => {});
  useEffect(() => {
    loadPending();
  }, []);

  function load() {
    setLoading(true);
    client
      .get("/admin/students")
      .then((res) => setStudents(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleStatusChange(s, status) {
    try {
      await client.put(`/admin/students/${s.id}`, { status });
      toast.success(`${s.name} ${status === "active" ? "enabled" : "disabled"}`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleDelete(s) {
    try {
      await client.delete(`/admin/students/${s.id}`);
      toast.success(`${s.name} deleted`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  function openMove(s) {
    setToMove(s);
    setMove({ batch: "", reason: "" });
    setMoveHistory([]);
    client.get("/admin/batches").then((res) => setBatches(res.data.filter((b) => !b.combined))).catch(() => setBatches([]));
    client.get(`/admin/students/${s.id}/class-history`).then((res) => setMoveHistory(res.data)).catch(() => {});
  }

  async function handleMove(e) {
    e.preventDefault();
    setMoving(true);
    try {
      const res = await client.post(`/admin/students/${toMove.id}/class`, move);
      toast.success(`${toMove.name} moved from ${res.data.old_batch || "no class"} to ${res.data.batch}. Their history is kept.`);
      setToMove(null);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setMoving(false);
    }
  }

  async function handleResetFace(s) {
    try {
      await client.delete(`/admin/students/${s.id}/face`);
      toast.success(`${s.name}'s face was reset. They'll register it again at their next sign-in.`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AuthImage
                src={row.original.photo_url}
                className="aspect-square h-full w-full object-cover"
                fallback={<AvatarFallback>{initials(row.original.name)}</AvatarFallback>}
              />
            </Avatar>
            <span className="font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "student_id_number",
        header: ({ column }) => <DataTableColumnHeader column={column} title="ID number" />,
        meta: { label: "ID number" },
      },
      {
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        meta: { label: "Email" },
      },
      {
        accessorKey: "department",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Department" />,
        meta: { label: "Department" },
        filterFn: "equalsString",
        cell: ({ getValue }) => getValue() || "—",
      },
      {
        accessorKey: "batch",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        meta: { label: "Batch" },
        filterFn: "equalsString",
        cell: ({ getValue }) => getValue() || "—",
      },
      {
        id: "face",
        accessorFn: (r) => (r.face_enrolled ? "registered" : "missing"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Face" />,
        meta: { label: "Face" },
        filterFn: "equalsString",
        cell: ({ row }) =>
          row.original.face_enrolled ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <ScanFace className="h-4 w-4" /> Registered
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Not yet</span>
          ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status" },
        filterFn: "equalsString",
        cell: ({ row }) => <StatusBadge status={row.original.status} label={row.original.status} className="capitalize" />,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => {
          const s = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/admin/students/${s.id}/report`}>
                    <FileText /> View report
                  </Link>
                </DropdownMenuItem>
                {canEdit &&
                  (s.status === "active" ? (
                    <DropdownMenuItem onSelect={() => handleStatusChange(s, "disabled")}>
                      <Ban /> Disable
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => handleStatusChange(s, "active")}>
                      <CheckCircle2 /> Enable
                    </DropdownMenuItem>
                  ))}
                {canEdit && (
                  <DropdownMenuItem onSelect={() => setEditingStudent(s)}>
                    <Pencil /> Edit details
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onSelect={() => openMove(s)}>
                    <ArrowRightLeft /> Correct class
                  </DropdownMenuItem>
                )}
                {canEdit && s.face_enrolled && (
                  <DropdownMenuItem onSelect={() => setToResetFace(s)}>
                    <ScanFace /> Reset face
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(s)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Students" description="Everyone registered through the student sign-up page." />

      {error && <Alert>{error}</Alert>}

      <Tabs value={tab} onValueChange={(v) => setParams(v === "requests" ? { tab: v } : {})}>
        <TabsList>
          <TabsTrigger value="students">Students</TabsTrigger>
          <TabsTrigger value="requests">
            Profile change requests
            {pendingRequests > 0 && <span className="ml-2 rounded-full bg-warning px-1.5 text-xs text-white">{pendingRequests}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-4">
          <ProfileRequestsAdmin
            canEdit={canEdit}
            onChanged={() => {
              loadPending();
              load();
            }}
          />
        </TabsContent>
        <TabsContent value="students" className="mt-4">

      <DataTable
        columns={columns}
        data={students}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search name, ID or email..."
        filters={[
          { columnId: "batch", label: "Batch" },
          { columnId: "department", label: "Department" },
          {
            columnId: "face",
            label: "Face",
            options: [
              { value: "registered", label: "Registered" },
              { value: "missing", label: "Not yet" },
            ],
          },
          {
            columnId: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
            ],
          },
        ]}
        exportName="students"
        emptyText="No students registered yet."
      />
        </TabsContent>
      </Tabs>

      {editingStudent && (
        <EditStudentDialog
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={() => {
            setEditingStudent(null);
            load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name}?`}
        description="This deletes the student and all their attendance history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => handleDelete(toDelete)}
      />

      <Dialog open={!!toMove} onOpenChange={(o) => !o && setToMove(null)}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleMove} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-primary" /> Correct class: {toMove?.name}
              </DialogTitle>
              <DialogDescription>
                Moves the student to another class without recreating the account. Their profile, face, payments and submissions stay
                as they are, and past attendance keeps its original class and sessions. From now on they follow the new class's
                timetable. The change is logged.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              Current class: <strong>{toMove?.batch || "none"}</strong>
            </p>
            <div className="space-y-1.5">
              <Label>New class</Label>
              <Select value={move.batch} onValueChange={(batch) => setMove((m) => ({ ...m, batch }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose the correct class" />
                </SelectTrigger>
                <SelectContent>
                  {batches
                    .filter((b) => b.code !== toMove?.batch)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.code}>
                        {b.code}
                        {b.name ? ` · ${b.name}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="move-reason">Reason</Label>
              <Input
                id="move-reason"
                required
                maxLength={500}
                placeholder="e.g. Registered in the wrong class"
                value={move.reason}
                onChange={(e) => setMove((m) => ({ ...m, reason: e.target.value }))}
              />
            </div>
            {moveHistory.length > 0 && (
              <div className="space-y-1 rounded-md border p-2 text-xs">
                <p className="font-medium">Previous corrections</p>
                {moveHistory.map((h) => (
                  <p key={h.id} className="text-muted-foreground">
                    {new Date(h.changed_at).toLocaleString()}: {h.old_batch || "none"} → {h.new_batch || "none"} by {h.changed_by_name}
                    {h.reason ? ` (${h.reason})` : ""}
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setToMove(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={moving || !move.batch || !move.reason.trim()}>
                {moving ? "Saving..." : "Correct class"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toResetFace}
        onOpenChange={(o) => !o && setToResetFace(null)}
        title={`Reset ${toResetFace?.name}'s face?`}
        description="Their registered face is deleted. They can't check in until they register their face again, which they'll be asked to do at their next sign-in."
        confirmLabel="Reset face"
        onConfirm={() => handleResetFace(toResetFace)}
      />
    </div>
  );
}
