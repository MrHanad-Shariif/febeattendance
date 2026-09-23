import { useEffect, useMemo, useState } from "react";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge, { STATUS_LABELS } from "@/components/StatusBadge.jsx";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function History() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get("/me/history")
      .then((res) => setRecords(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo(
    () => [
      {
        accessorKey: "date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        meta: { label: "Date" },
        cell: ({ getValue }) => <span className="whitespace-nowrap font-medium">{getValue()}</span>,
      },
      {
        accessorKey: "classes_summary",
        header: "Classes",
        cell: ({ getValue }) => getValue() || "—",
      },
      {
        id: "checkin",
        accessorFn: (r) => formatDateTime(r.checkin_at),
        header: "Checked in",
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span>,
      },
      {
        id: "checkout",
        accessorFn: (r) => formatDateTime(r.checkout_at),
        header: "Checked out",
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span>,
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status" },
        filterFn: "equalsString",
        cell: ({ row }) => <StatusBadge status={row.original.status} label={row.original.status_label} />,
      },
      {
        accessorKey: "remarks",
        header: "Remarks",
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() || "—"}</span>,
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader title="My attendance history" description="Every day you were scheduled, with how it was recorded." />
      {error && <Alert>{error}</Alert>}
      <DataTable
        columns={columns}
        data={records}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search classes or remarks..."
        filters={[
          {
            columnId: "status",
            label: "Status",
            options: ["on_time", "late", "absent", "left_early", "no_checkout"].map((s) => ({ value: s, label: STATUS_LABELS[s] })),
          },
        ]}
        exportName="my-attendance"
        initialSorting={[{ id: "date", desc: true }]}
        emptyText="No attendance records yet."
      />
    </div>
  );
}
