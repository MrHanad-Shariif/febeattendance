import { useEffect, useMemo, useState } from "react";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { ACTIONS, ACTION_TONE } from "./Roles.jsx";

const ACTION_ORDER = Object.fromEntries(ACTIONS.map((a, i) => [a.key, i]));
const ACTION_OPTIONS = ACTIONS.map((a) => ({ value: a.key, label: a.label }));

/**
 * Authentication > Permissions: the fixed catalogue of "<resource>:<action>"
 * permissions the system checks, one row each, with the roles that
 * currently grant it. Permissions are defined by the application; roles are
 * what admins edit.
 */
export default function Permissions() {
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get("/access/permissions")
      .then((res) => setCatalogue(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () =>
      catalogue.flatMap((res, ri) =>
        res.actions.map((a) => ({
          ...a,
          resource: res.resource,
          screen: res.label,
          group: res.group,
          order: ri * 10 + ACTION_ORDER[a.action],
        }))
      ),
    [catalogue]
  );

  const roleOptions = useMemo(
    () => [...new Set(rows.flatMap((r) => r.roles))].sort().map((r) => ({ value: r, label: r })),
    [rows]
  );

  const columns = useMemo(
    () => [
      {
        accessorKey: "screen",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Screen / record" />,
        meta: { label: "Screen / record" },
        sortingFn: (a, b) => a.original.order - b.original.order,
        cell: ({ row }) => (
          <div className="min-w-[160px]">
            <p className="font-medium">{row.original.screen}</p>
            <p className="text-xs text-muted-foreground">{row.original.group}</p>
          </div>
        ),
      },
      {
        accessorKey: "group",
        header: "Group",
        meta: { label: "Group" },
        filterFn: exactFilter,
      },
      {
        accessorKey: "action",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Action" />,
        meta: { label: "Action", exportValue: (r) => r.label },
        filterFn: exactFilter,
        sortingFn: (a, b) => ACTION_ORDER[a.original.action] - ACTION_ORDER[b.original.action],
        cell: ({ row }) => <Badge variant={ACTION_TONE[row.original.action]}>{row.original.label}</Badge>,
      },
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        meta: { label: "Code" },
        cell: ({ getValue }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{getValue()}</code>,
      },
      {
        accessorKey: "description",
        header: "Allows",
        enableSorting: false,
        meta: { label: "Allows" },
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
      },
      {
        id: "roles",
        accessorFn: (r) => r.roles.join(", "),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Granted by" />,
        meta: { label: "Granted by" },
        filterFn: (row, _id, value) => row.original.roles.includes(value),
        sortingFn: (a, b) => a.original.roles.length - b.original.roles.length,
        cell: ({ row }) =>
          row.original.roles.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.roles.map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No role</span>
          ),
      },
    ],
    []
  );

  const screens = catalogue.length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Permissions"
        description={`${rows.length} permissions across ${screens} screens. Each is one action (view, add, edit or delete) on one screen or record type; roles bundle them.`}
      />

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => r.code}
        searchPlaceholder="Search permission, screen or role..."
        filters={[
          { columnId: "group", label: "Group" },
          { columnId: "action", label: "Action", options: ACTION_OPTIONS },
          { columnId: "roles", label: "Role", options: roleOptions },
        ]}
        initialSorting={[{ id: "screen", desc: false }]}
        initialVisibility={{ group: false }}
        pageSize={20}
        exportName="permissions"
        emptyText="No permissions match."
      />
    </div>
  );
}
