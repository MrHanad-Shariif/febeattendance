import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function Count({ value, danger }) {
  return value > 0 && danger ? <span className="font-semibold text-danger">{value}</span> : <span>{value}</span>;
}

export default function Reports() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    client
      .get("/admin/summary", { params: { month } })
      .then((res) => setRows(res.data.rows))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [month]);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await client.get("/admin/attendance/export", { params: { month }, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const columns = useMemo(() => {
    const num = (key, title, opts = {}) => ({
      accessorKey: key,
      header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
      meta: { label: title },
      cell: ({ getValue }) => <Count value={getValue()} danger={opts.danger} />,
    });
    return [
      {
        accessorKey: "lecturer_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lecturer" />,
        meta: { label: "Lecturer" },
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      },
      num("on_time", "On time"),
      num("late", "Late"),
      num("absent_unjustified", "Absent (unjust.)", { danger: true }),
      num("absent_justified", "Absent (just.)"),
      num("left_early_unjustified", "Early (unjust.)", { danger: true }),
      num("left_early_justified", "Early (just.)"),
      num("no_checkout", "No check-out"),
      num("sessions_scheduled", "Sessions scheduled"),
      num("sessions_covered", "Sessions covered"),
    ];
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly summary"
        description="Absences and early leaves are split by whether a remark (permission/justification) was recorded."
        actions={
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="month" className="text-xs text-muted-foreground">
                Month
              </Label>
              <Input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
            </div>
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              <Download /> {exporting ? "Exporting..." : "Full report CSV"}
            </Button>
          </>
        }
      />

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => String(r.lecturer_id)}
        searchPlaceholder="Search lecturers..."
        exportName={`summary-${month}`}
        emptyText="No lecturers yet."
        pageSize={20}
      />
    </div>
  );
}
