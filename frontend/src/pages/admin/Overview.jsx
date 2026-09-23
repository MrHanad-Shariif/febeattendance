import { useEffect, useMemo, useState } from "react";
import { Check, Copy, QrCode, Tv } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import StatusBadge, { STATUS_LABELS } from "@/components/StatusBadge.jsx";
import RemarksCell from "@/components/RemarksCell.jsx";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/utils";

const STATUSES = ["on_time", "late", "absent", "left_early", "no_checkout", "not_yet"];

function classesSummary(classes) {
  if (!classes || classes.length === 0) return "—";
  if (classes.length === 1) {
    const c = classes[0];
    return c.batch ? `${c.course_name} (${c.batch})` : c.course_name;
  }
  return `${classes.length} classes`;
}

export default function Overview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [kioskUrl, setKioskUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    client
      .get("/admin/attendance/today")
      .then((res) => setRows(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
    client
      .get("/admin/qrcode.png", { responseType: "blob" })
      .then((res) => setQrUrl(URL.createObjectURL(res.data)))
      .catch(() => {});
    client
      .get("/admin/kiosk-url")
      .then((res) => setKioskUrl(res.data.url))
      .catch(() => {});
  }, []);

  function handleRemarkSaved(updated) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    toast.success("Remark saved");
  }

  const counts = useMemo(
    () =>
      rows.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {}),
    [rows]
  );

  const columns = useMemo(
    () => [
      {
        accessorKey: "lecturer_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lecturer" />,
        meta: { label: "Lecturer" },
        cell: ({ row }) => <span className="font-medium">{row.original.lecturer_name}</span>,
      },
      {
        id: "classes",
        accessorFn: (r) => classesSummary(r.classes),
        header: "Classes today",
        cell: ({ row }) => (
          <span title={(row.original.classes || []).map((c) => c.course_name).join(", ")}>
            {classesSummary(row.original.classes)}
          </span>
        ),
      },
      {
        id: "scheduled",
        accessorFn: (r) => `${formatTime(r.scheduled_start)} - ${formatTime(r.scheduled_end)}`,
        header: "Scheduled",
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span>,
      },
      {
        id: "checkin",
        accessorFn: (r) => formatTime(r.checkin_at),
        header: "Checked in",
      },
      {
        id: "checkout",
        accessorFn: (r) => formatTime(r.checkout_at),
        header: "Checked out",
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status" },
        filterFn: "equalsString",
        cell: ({ row }) => <StatusBadge status={row.original.status} label={row.original.status_label} />,
      },
      {
        id: "remarks",
        accessorFn: (r) => r.remarks || "",
        header: "Remarks",
        enableSorting: false,
        cell: ({ row }) => <RemarksCell record={row.original} onSaved={handleRemarkSaved} />,
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Today's attendance" description="Live check-in status for every lecturer teaching today." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4 text-primary" /> Check-in QR code
            </CardTitle>
            <CardDescription>Print this and place it on tables or in rooms.</CardDescription>
          </CardHeader>
          <CardContent>
            {qrUrl ? (
              <img src={qrUrl} alt="Check-in QR code" className="mx-auto h-40 w-40 rounded-lg bg-white p-2" />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Tv className="h-4 w-4 text-primary" /> Kiosk screen link
            </CardTitle>
            <CardDescription>
              Open this on the screen at the campus entrance so lecturers can read the rotating code.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">{kioskUrl || "Loading..."}</code>
              {kioskUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(kioskUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {STATUSES.map((s) => (
                <div key={s} className="rounded-lg bg-muted/60 px-2 py-2 text-center">
                  <p className="text-xl font-bold">{counts[s] || 0}</p>
                  <StatusBadge status={s} className="mt-1 whitespace-nowrap px-1.5 text-[10px]" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => String(r.lecturer_id)}
        searchPlaceholder="Search lecturers or classes..."
        filters={[
          {
            columnId: "status",
            label: "Status",
            options: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
          },
        ]}
        exportName="attendance-today"
        emptyText="No classes scheduled today."
        initialVisibility={{}}
      />
    </div>
  );
}
