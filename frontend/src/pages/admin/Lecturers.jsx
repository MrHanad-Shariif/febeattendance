import { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, MailPlus, MoreHorizontal, Pencil, Send, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge from "@/components/StatusBadge.jsx";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext.jsx";

const STATUS_ORDER = ["invited", "active", "disabled"];
const STATUS_OPTIONS = [
  { value: "invited", label: "Invited" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

export default function Lecturers() {
  const { can } = useAuth();
  const canEdit = can("lecturers:edit");
  const canDelete = can("lecturers:delete");
  const [lecturers, setLecturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", status: "" });
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    client
      .get("/admin/lecturers")
      .then((res) =>
        setLecturers([...res.data].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)))
      )
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await client.post("/admin/lecturers", { name, email });
      toast.success(`Invite sent to ${email}`);
      setName("");
      setEmail("");
      setAddOpen(false);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleResend(l) {
    try {
      await client.post(`/admin/lecturers/${l.id}/resend-invite`);
      toast.success(`Invite re-sent to ${l.email}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleStatusChange(l, status) {
    try {
      await client.put(`/admin/lecturers/${l.id}`, { status });
      toast.success(`${l.name} ${status === "active" ? "enabled" : "disabled"}`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  function openEdit(l) {
    setEditForm({
      name: l.name,
      email: l.email.endsWith("@example.invalid") ? "" : l.email,
      status: l.status,
    });
    setEditing(l);
  }

  async function handleUpdate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await client.put(`/admin/lecturers/${editing.id}`, editForm);
      const emailChanged = res.data.email !== editing.email;
      toast.success(
        emailChanged && res.data.status === "invited"
          ? `${res.data.name} updated — invite sent to ${res.data.email}`
          : `${res.data.name} updated`
      );
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(l) {
    try {
      await client.delete(`/admin/lecturers/${l.id}`);
      toast.success(`${l.name} deleted`);
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
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        meta: { label: "Email" },
        cell: ({ row }) =>
          row.original.email.endsWith("@example.invalid") ? (
            <em className="text-muted-foreground">not set</em>
          ) : (
            row.original.email
          ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status" },
        filterFn: "equalsString",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Added" />,
        meta: { label: "Added" },
        cell: ({ row }) => (row.original.created_at ? new Date(row.original.created_at).toLocaleDateString() : "—"),
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => {
          const l = row.original;
          if (!canEdit && !canDelete) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onSelect={() => openEdit(l)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {canEdit && l.status === "invited" && (
                  <DropdownMenuItem onSelect={() => handleResend(l)}>
                    <Send /> Resend invite
                  </DropdownMenuItem>
                )}
                {canEdit && l.status === "active" && (
                  <DropdownMenuItem onSelect={() => handleStatusChange(l, "disabled")}>
                    <Ban /> Disable
                  </DropdownMenuItem>
                )}
                {canEdit && l.status === "disabled" && (
                  <DropdownMenuItem onSelect={() => handleStatusChange(l, "active")}>
                    <CheckCircle2 /> Enable
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    {canEdit && <DropdownMenuSeparator />}
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(l)}>
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
      <PageHeader
        title="Lecturers"
        description="Invite lecturers and manage their accounts."
        actions={
          can("lecturers:add") && (
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus /> Add lecturer
            </Button>
          )
        }
      />

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={lecturers}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search name or email..."
        filters={[{ columnId: "status", label: "Status", options: STATUS_OPTIONS }]}
        exportName="lecturers"
        selectable={canEdit}
        renderBulkActions={(selected, clear) => (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const targets = selected.filter((l) => l.status === "active");
                await Promise.allSettled(targets.map((l) => client.put(`/admin/lecturers/${l.id}`, { status: "disabled" })));
                toast.success(`${targets.length} lecturer(s) disabled`);
                clear();
                load();
              }}
            >
              <Ban /> Disable
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const targets = selected.filter((l) => l.status === "disabled");
                await Promise.allSettled(targets.map((l) => client.put(`/admin/lecturers/${l.id}`, { status: "active" })));
                toast.success(`${targets.length} lecturer(s) enabled`);
                clear();
                load();
              }}
            >
              <CheckCircle2 /> Enable
            </Button>
          </>
        )}
        emptyText="No lecturers yet."
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MailPlus className="h-5 w-5 text-primary" /> Add lecturer
              </DialogTitle>
              <DialogDescription>They will receive an email with a link to set their own password.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="lec-name">Full name</Label>
              <Input id="lec-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lec-email">Email</Label>
              <Input id="lec-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Sending invite..." : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={handleUpdate} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" /> Edit lecturer
              </DialogTitle>
              <DialogDescription>
                {editing?.status === "invited"
                  ? "Changing the email re-sends the invite to the new address."
                  : "Update the lecturer's details. They sign in with the new email from now on."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="edit-lec-name">Full name</Label>
              <Input
                id="edit-lec-name"
                required
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-lec-email">Email</Label>
              <Input
                id="edit-lec-email"
                type="email"
                required
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            {editing?.status !== "invited" && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-lec-status">Status</Label>
                <Select value={editForm.status} onValueChange={(status) => setEditForm((f) => ({ ...f, status }))}>
                  <SelectTrigger id="edit-lec-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name}?`}
        description="This deletes the lecturer and all their attendance history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => handleDelete(toDelete)}
      />
    </div>
  );
}
