import { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, MailPlus, MoreHorizontal, Send, Trash2, UserPlus } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

const STATUS_ORDER = ["invited", "active", "disabled"];
const STATUS_OPTIONS = [
  { value: "invited", label: "Invited" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

export default function Lecturers() {
  const [lecturers, setLecturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState(null);

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
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {l.status === "invited" && (
                  <DropdownMenuItem onSelect={() => handleResend(l)}>
                    <Send /> Resend invite
                  </DropdownMenuItem>
                )}
                {l.status === "active" && (
                  <DropdownMenuItem onSelect={() => handleStatusChange(l, "disabled")}>
                    <Ban /> Disable
                  </DropdownMenuItem>
                )}
                {l.status === "disabled" && (
                  <DropdownMenuItem onSelect={() => handleStatusChange(l, "active")}>
                    <CheckCircle2 /> Enable
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(l)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
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
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus /> Add lecturer
          </Button>
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
        selectable
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
