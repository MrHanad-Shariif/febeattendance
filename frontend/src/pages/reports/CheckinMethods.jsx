import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A board session with more check-ins than enrolled students (or close to
// all of them) deserves a look: GPS can't tell the classroom from the cafeteria.
function looksOdd(r) {
  return r.board > 0 && r.enrolled > 0 && r.checked_in / r.enrolled >= 0.95;
}

/**
 * Reports > Check-in methods: per class session, how many students checked in
 * with the lecturer's screen (QR + rotating code) and how many with a board
 * code. Admins use it to spot classes where board-code attendance looks off.
 */
export default function CheckinMethods() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    client
      .get("/admin/reports/checkin-methods", { params: { from, to } })
      .then((res) => {
        setRows(res.data.rows);
        setError("");
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [from, to]);

  const columns = useMemo(() => {
    const num = (key, title) => ({
      accessorKey: key,
      header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
      meta: { label: title, className: "text-right tabular-nums" },
    });
    return [
      { accessorKey: "date", header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />, meta: { label: "Date" } },
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Class" />,
        meta: { label: "Class" },
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.course_name}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.batch} · {row.original.lecturer_name}
            </p>
          </div>
        ),
      },
      { accessorKey: "batch", header: "Batch", meta: { label: "Batch" }, filterFn: "equalsString" },
      num("enrolled", "Enrolled"),
      num("qr", "QR"),
      num("board", "Board"),
      {
        accessorKey: "checked_in",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Checked in" />,
        meta: { label: "Checked in", className: "text-right tabular-nums" },
        cell: ({ row }) => (
          <span className={looksOdd(row.original) ? "inline-flex items-center gap-1 font-semibold text-warning" : ""}>
            {looksOdd(row.original) && <AlertTriangle className="h-3.5 w-3.5" />}
            {row.original.checked_in}
          </span>
        ),
      },
      {
        accessorKey: "board_share",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Board %" />,
        meta: { label: "Board %", className: "text-right tabular-nums" },
        cell: ({ getValue }) => `${getValue()}%`,
      },
      {
        accessorKey: "board_opened",
        header: "Board session",
        meta: { label: "Board session", exportValue: (r) => (r.board_opened ? `Yes (${r.board_started_by || "?"})` : "No") },
        cell: ({ row }) =>
          row.original.board_opened ? (
            <div className="text-xs">
              <Badge variant="info">Opened</Badge>
              <p className="mt-1 text-muted-foreground">by {row.original.board_started_by || "unknown"}</p>
              {row.original.board_code_changes > 0 && (
                <p className="text-muted-foreground">code changed {row.original.board_code_changes}×</p>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ];
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-in methods"
        description="QR (lecturer's screen) versus board-code check-ins per class session. Highlighted rows have almost everyone checked in by board code: worth comparing with a headcount."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cm-from">From</Label>
          <Input id="cm-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-to">To</Label>
          <Input id="cm-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => `${r.timetable_id}-${r.date}`}
        searchPlaceholder="Search class, batch or lecturer..."
        filters={[{ columnId: "batch", label: "Batch" }]}
        initialVisibility={{ batch: false }}
        exportName="checkin-methods"
        emptyText="No student check-ins in this period."
      />
    </div>
  );
}
