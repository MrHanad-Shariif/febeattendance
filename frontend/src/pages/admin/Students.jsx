import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, FileText, MoreHorizontal, ScanFace, Trash2 } from "lucide-react";
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
import { initials } from "@/lib/utils";

export default function Students() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [toResetFace, setToResetFace] = useState(null);

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
                {s.status === "active" ? (
                  <DropdownMenuItem onSelect={() => handleStatusChange(s, "disabled")}>
                    <Ban /> Disable
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => handleStatusChange(s, "active")}>
                    <CheckCircle2 /> Enable
                  </DropdownMenuItem>
                )}
                {s.face_enrolled && (
                  <DropdownMenuItem onSelect={() => setToResetFace(s)}>
                    <ScanFace /> Reset face
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(s)}>
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
      <PageHeader title="Students" description="Everyone registered through the student sign-up page." />

      {error && <Alert>{error}</Alert>}

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

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name}?`}
        description="This deletes the student and all their attendance history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => handleDelete(toDelete)}
      />

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
