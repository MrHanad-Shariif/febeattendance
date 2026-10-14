import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import ExportMenu from "@/components/ExportMenu.jsx";
import PeriodFields, { periodParams, periodReady } from "@/components/PeriodFields.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { currentMonth, todayIso } from "@/lib/attendance";

const h = (t) => ({ column }) => <DataTableColumnHeader column={column} title={t} />;
const n = (k, t) => ({ accessorKey: k, header: h(t), meta: { label: t }, cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> });

export function usePeriod() {
  const [q, setQ] = useState({ period: "semester", date: todayIso(), month: currentMonth(), year: "", from: "", to: "" });
  return [q, (patch) => setQ((s) => ({ ...s, ...patch }))];
}

/** Every lecturer's late minutes, equivalent sessions and makeups. */
export default function Punctuality() {
  const [q, set] = usePeriod();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const params = useMemo(() => periodParams(q), [q]);
  useEffect(() => {
    if (!periodReady(q)) return;
    client
      .get("/admin/punctuality", { params })
      .then((r) => {
        setData(r.data);
        setError("");
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(
    () => [
      {
        accessorKey: "lecturer_name",
        header: h("Lecturer"),
        meta: { label: "Lecturer" },
        cell: ({ row }) => (
          <Link to={`/admin/punctuality/${row.original.lecturer_id}`} className="font-medium text-primary hover:underline">
            {row.original.lecturer_name}
          </Link>
        ),
      },
      { accessorKey: "department", header: "Department", meta: { label: "Department" }, cell: ({ getValue }) => getValue() || "—" },
      n("scheduled_sessions", "Scheduled"),
      n("conducted_sessions", "Conducted"),
      n("late_sessions", "Late sessions"),
      n("late_minutes", "Late minutes"),
      n("equivalent_sessions", "Equivalent sessions"),
      n("makeup_completed", "Makeups done"),
      n("makeup_outstanding", "Outstanding"),
      {
        accessorKey: "needs_review",
        header: "Review",
        meta: { label: "Review", exportValue: (r) => (r.needs_review ? "Needs review" : "") },
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge variant="warning">
              <AlertTriangle className="mr-1 h-3 w-3" /> Review
            </Badge>
          ) : null,
      },
    ],
    []
  );

  const threshold = data?.rows?.[0]?.minutes_per_equivalent_session ?? 90;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lateness & makeup sessions"
        description="Late minutes per lecturer, measured per session against its scheduled start. Click a lecturer for their session history, reviews and makeups."
        actions={<ExportMenu url="/admin/punctuality/export" params={params} name="Lecturer_Punctuality" disabled={!periodReady(q)} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PeriodFields q={q} set={set} />
      </div>
      {error && <Alert>{error}</Alert>}
      <p className="text-xs text-muted-foreground">
        {data?.label}. Every {threshold} late minutes count as one equivalent session and flag the lecturer for Academic Office review. Nothing is marked
        missed automatically; absences and exempted sessions are never counted as lateness.
      </p>
      <DataTable columns={columns} data={data?.rows || []} loading={!data && !error} getRowId={(r) => String(r.lecturer_id)} exportName="punctuality" emptyText="No lecturer sessions in this period." />
    </div>
  );
}
