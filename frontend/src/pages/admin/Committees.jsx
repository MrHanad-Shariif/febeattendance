import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { CommitteeFormDialog } from "@/components/committees/CommitteeFormDialog.jsx";
import { useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KIND_OPTIONS } from "@/lib/committees";

/** Admin: create committees, set chairpersons and members. */
export default function Committees() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi("/committees?scope=all", []);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new
  const [toDelete, setToDelete] = useState(null);

  async function remove(c) {
    try {
      await client.delete(`/committees/${c.id}`);
      toast.success(`${c.name} deleted`);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Committee" />,
        meta: { label: "Committee" },
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "kind",
        header: "Type",
        meta: { label: "Type", exportValue: (r) => r.kind_label },
        filterFn: exactFilter,
        cell: ({ row }) => <Badge variant={row.original.kind === "administration" ? "purple" : "default"}>{row.original.kind_label}</Badge>,
      },
      {
        accessorKey: "chairperson_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Chairperson" />,
        meta: { label: "Chairperson" },
        cell: ({ row }) => row.original.chairperson_name || <em className="text-muted-foreground">not assigned</em>,
      },
      { accessorKey: "member_count", header: "Members", meta: { label: "Members" } },
      { accessorKey: "task_pending", header: "Open tasks", meta: { label: "Open tasks" } },
      {
        accessorKey: "status",
        header: "Status",
        meta: { label: "Status" },
        filterFn: exactFilter,
        cell: ({ row }) => <Badge variant={row.original.status === "active" ? "success" : "muted"}>{row.original.status}</Badge>,
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(row.original)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manage committees"
        description="Create committees and the Administration Team, and choose each chairperson and member from existing staff accounts."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus /> New committee
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <DataTable
        columns={columns}
        data={data || []}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search committees..."
        filters={[
          { columnId: "kind", label: "Type", options: KIND_OPTIONS },
          { columnId: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }] },
        ]}
        exportName="committees"
        onRowClick={(c) => navigate(`/committees/${c.id}`)}
        emptyText="No committees yet. Create the first one."
      />
      <CommitteeFormDialog
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        committee={editing || undefined}
        onSaved={(c) => (editing ? reload() : navigate(`/committees/${c.id}`))}
      />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name}?`}
        description="Only committees with no tasks, meetings or minutes can be deleted. Archive the others instead."
        confirmLabel="Delete"
        onConfirm={() => remove(toDelete)}
      />
    </div>
  );
}
