import { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, MoreHorizontal, Send, ShieldCheck, Trash2, UserCog, UserPlus } from "lucide-react";
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
];
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
 * Authentication > Users: every staff account (administrative staff and
 * lecturers) with the roles it holds. Access to management screens comes
 * only from roles; lecturers keep their own teaching features without one.
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

  const canEdit = can("users:edit");
  const canDelete = can("users:delete");

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
        accessorKey: "account_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
        meta: { label: "Account", exportValue: (r) => (r.account_type === "admin" ? "Staff" : "Lecturer") },
        filterFn: "equalsString",
        cell: ({ row }) => (
          <Badge variant={row.original.account_type === "admin" ? "info" : "secondary"}>
            {row.original.account_type === "admin" ? "Staff" : "Lecturer"}
          </Badge>
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
              {row.original.account_type === "lecturer" ? "Teaching features only" : "No access yet"}
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
          if (u.id === me?.id || (!canEdit && !canDelete)) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onSelect={() => openRoles(u)}>
                    <ShieldCheck /> Assign roles
                  </DropdownMenuItem>
                )}
                {canEdit && u.status === "invited" && (
                  <DropdownMenuItem onSelect={() => resend(u)}>
                    <Send /> Resend invite
                  </DropdownMenuItem>
                )}
                {canEdit && u.status === "active" && (
                  <DropdownMenuItem onSelect={() => update(u, { status: "disabled" }, `${u.name} disabled`)}>
                    <Ban /> Disable
                  </DropdownMenuItem>
                )}
                {canEdit && u.status === "disabled" && (
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
    [me?.id, canEdit, canDelete]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Staff and lecturer accounts and the roles that decide what each one can view, add, edit or delete."
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
        searchPlaceholder="Search name, email or role..."
        filters={[
          { columnId: "account_type", label: "Account", options: TYPE_OPTIONS },
          { columnId: "status", label: "Status", options: STATUS_OPTIONS },
        ]}
        exportName="users"
        emptyText="No staff accounts yet."
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
