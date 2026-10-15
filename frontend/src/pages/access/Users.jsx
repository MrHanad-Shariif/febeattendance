import { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, KeyRound, MoreHorizontal, Send, ShieldCheck, Trash2, UserCog, UserPlus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge from "@/components/StatusBadge.jsx";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext.jsx";
import { initials } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "admin", label: "Staff" },
  { value: "lecturer", label: "Lecturer" },
  { value: "student", label: "Student" },
];
const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
const TYPE_BADGES = { admin: "info", lecturer: "secondary", student: "outline" };
const MIN_PASSWORD_LENGTH = 8;
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "disabled", label: "Disabled" },
];

/** Tick-list of roles, each with its description and permission count. */
export function RolePicker({ roles, value, onChange, idPrefix }) {
  const toggle = (id, on) => onChange(on ? [...value, id] : value.filter((v) => v !== id));
  return (
    <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
      {roles.map((r) => (
        <li key={r.id}>
          <label htmlFor={`${idPrefix}-${r.id}`} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-accent">
            <Checkbox
              id={`${idPrefix}-${r.id}`}
              className="mt-0.5"
              checked={value.includes(r.id)}
              onCheckedChange={(on) => toggle(r.id, !!on)}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                {r.name}
                {r.is_system && <Badge variant="purple">System</Badge>}
              </span>
              <span className="block text-xs text-muted-foreground">
                {r.description ? `${r.description} · ` : ""}
                {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
              </span>
            </span>
          </label>
        </li>
      ))}
      {roles.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">No roles yet. Create one on the Roles page.</li>}
    </ul>
  );
}

/**
 * Authentication > Users: every account (administrative staff, lecturers
 * and students) with the roles it holds. Access to management screens comes
 * only from roles; lecturers keep their own teaching features without one,
 * and students never hold roles. A Super Admin can set anyone's password.
 */
export default function Users() {
  const { user: me, can } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role_ids: [] });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editRoles, setEditRoles] = useState([]);
  const [toDelete, setToDelete] = useState(null);
  const [pwUser, setPwUser] = useState(null);
  const [pw, setPw] = useState({ password: "", confirm: "" });

  function load() {
    setLoading(true);
    Promise.all([client.get("/access/users"), client.get("/access/roles")])
      .then(([u, r]) => {
        setUsers(u.data);
        setRoles(r.data);
        setError("");
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await client.post("/access/users", form);
      toast.success(`Invite sent to ${form.email}`);
      setAddOpen(false);
      setForm({ name: "", email: "", role_ids: [] });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function openRoles(u) {
    setEditRoles(u.roles.map((r) => r.id));
    setEditing(u);
  }

  async function saveRoles(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await client.put(`/access/users/${editing.id}`, { role_ids: editRoles });
      toast.success(`Roles updated for ${res.data.name}`);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function update(u, body, message) {
    try {
      await client.put(`/access/users/${u.id}`, body);
      toast.success(message);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function resend(u) {
    try {
      await client.post(`/access/users/${u.id}/resend-invite`);
      toast.success(`Invite resent to ${u.email}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleDelete(u) {
    try {
      await client.delete(`/access/users/${u.id}`);
      toast.success(`${u.name} deleted`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  function openPassword(u) {
    setPw({ password: "", confirm: "" });
    setPwUser(u);
  }

  async function savePassword(e) {
    e.preventDefault();
    if (pw.password !== pw.confirm) {
      toast.error("The two passwords don't match");
      return;
    }
    setSaving(true);
    try {
      await client.post(`/access/users/${pwUser.id}/password`, { password: pw.password });
      toast.success(`Password changed for ${pwUser.name}`);
      setPwUser(null);
      setPw({ password: "", confirm: "" });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const canEdit = can("users:edit");
  const canDelete = can("users:delete");
  const canSetPassword = canEdit && !!me?.capabilities?.is_super_admin;

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.original.name}
                {row.original.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        // Hidden by default; lets the search box match email, student ID and class.
        id: "details",
        accessorFn: (r) => [r.email, r.student_id_number, r.batch].filter(Boolean).join(" "),
        header: "Email / Student ID",
        meta: { label: "Email / Student ID" },
      },
      {
        accessorKey: "account_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
        meta: { label: "Account", exportValue: (r) => TYPE_LABELS[r.account_type] || r.account_type },
        filterFn: "equalsString",
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <Badge variant={TYPE_BADGES[row.original.account_type] || "secondary"}>
              {TYPE_LABELS[row.original.account_type] || row.original.account_type}
            </Badge>
            {row.original.account_type === "student" && row.original.student_id_number && (
              <p className="text-xs text-muted-foreground">
                {row.original.student_id_number}
                {row.original.batch ? ` · ${row.original.batch}` : ""}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "roles",
        accessorFn: (r) => r.roles.map((x) => x.name).join(", "),
        header: "Roles",
        meta: { label: "Roles" },
        cell: ({ row }) =>
          row.original.roles.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.roles.map((r) => (
                <Badge key={r.id} variant={r.is_system ? "purple" : "default"}>
                  {r.name}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {{ lecturer: "Teaching features only", student: "Student portal only" }[row.original.account_type] || "No access yet"}
            </span>
          ),
      },
      {
        accessorKey: "permission_count",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Permissions" />,
        meta: { label: "Permissions", className: "text-right" },
        cell: ({ row }) => <span className="tabular-nums">{row.original.permission_count}</span>,
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status" },
        filterFn: "equalsString",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => {
          const u = row.original;
          const isStudent = u.account_type === "student";
          if (u.id === me?.id || (isStudent && !canSetPassword) || (!canEdit && !canDelete)) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && !isStudent && (
                  <DropdownMenuItem onSelect={() => openRoles(u)}>
                    <ShieldCheck /> Assign roles
                  </DropdownMenuItem>
                )}
                {canSetPassword && (
                  <DropdownMenuItem onSelect={() => openPassword(u)}>
                    <KeyRound /> Change password
                  </DropdownMenuItem>
                )}
                {canEdit && !isStudent && u.status === "invited" && (
                  <DropdownMenuItem onSelect={() => resend(u)}>
                    <Send /> Resend invite
                  </DropdownMenuItem>
                )}
                {canEdit && !isStudent && u.status === "active" && (
                  <DropdownMenuItem onSelect={() => update(u, { status: "disabled" }, `${u.name} disabled`)}>
                    <Ban /> Disable
                  </DropdownMenuItem>
                )}
                {canEdit && !isStudent && u.status === "disabled" && (
                  <DropdownMenuItem onSelect={() => update(u, { status: "active" }, `${u.name} enabled`)}>
                    <CheckCircle2 /> Enable
                  </DropdownMenuItem>
                )}
                {canDelete && u.account_type === "admin" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(u)}>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.id, canEdit, canDelete, canSetPassword]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Every staff, lecturer and student account, and the roles that decide what staff can view, add, edit or delete."
        actions={
          can("users:add") && (
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus /> Invite staff user
            </Button>
          )
        }
      />

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={users}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search name, email, role or student ID..."
        initialVisibility={{ details: false }}
        filters={[
          { columnId: "account_type", label: "Account", options: TYPE_OPTIONS },
          { columnId: "status", label: "Status", options: STATUS_OPTIONS },
        ]}
        exportName="users"
        emptyText="No user accounts yet."
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" /> Invite staff user
              </DialogTitle>
              <DialogDescription>
                They get an email to set their password. What they can do comes from the roles you tick. Lecturers are added on the Lecturers page.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Full name</Label>
              <Input id="user-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            {canEdit && (
              <div className="space-y-1.5">
                <Label>Roles</Label>
                <RolePicker roles={roles} value={form.role_ids} onChange={(role_ids) => setForm((f) => ({ ...f, role_ids }))} idPrefix="new-role" />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Sending invite..." : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={saveRoles} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-primary" /> Roles for {editing?.name}
              </DialogTitle>
              <DialogDescription>
                {editing?.account_type === "lecturer"
                  ? "Lecturers keep their own classes, QR and board codes without any role. Roles add management access on top."
                  : "The account can use exactly the screens and actions its roles allow."}
              </DialogDescription>
            </DialogHeader>
            <RolePicker roles={roles} value={editRoles} onChange={setEditRoles} idPrefix="edit-role" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save roles"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pwUser} onOpenChange={(o) => !o && setPwUser(null)}>
        <DialogContent>
          <form onSubmit={savePassword} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" /> Change password for {pwUser?.name}
              </DialogTitle>
              <DialogDescription>
                {pwUser?.email}. They are signed out everywhere and must sign in with the new password. Share it with them
                securely.
                {pwUser?.status === "invited" && " Their account is activated and the invite link stops working."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="pw-new">New password</Label>
              <Input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={pw.password}
                onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={pw.confirm}
                onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwUser(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Change password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name}?`}
        description="This staff account will be deleted and can no longer sign in."
        confirmLabel="Delete"
        onConfirm={() => handleDelete(toDelete)}
      />
    </div>
  );
}
