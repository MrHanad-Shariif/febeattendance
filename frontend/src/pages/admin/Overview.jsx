import { useEffect, useMemo, useState } from "react";
import { Check, Copy, QrCode, Tv } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import RemarksCell from "@/components/RemarksCell.jsx";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES, formatDate, todayIso } from "@/lib/attendance";

const SUMMARY_CATEGORIES = ["present", "late", "absent", "justified", "left_early", "no_checkout", "not_yet"];

/** Lecturer daily report: one row per teaching session (numbered per
 * lecturer), for today or any past date. */
export default function Overview() {
  const [day, setDay] = useState(todayIso());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [kioskUrl, setKioskUrl] = useState("");
  const [copied, setCopied] = useState(false);

  function load() {
    setLoading(true);
    setError("");
    client
      .get("/admin/attendance/daily", { params: { date: day } })
      .then((res) => setRows(res.data.rows))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [day]);

  useEffect(() => {
    client
      .get("/admin/qrcode.png", { responseType: "blob" })
      .then((res) => setQrUrl(URL.createObjectURL(res.data)))
      .catch(() => {});
    client
      .get("/admin/kiosk-url")
      .then((res) => setKioskUrl(res.data.url))
      .catch(() => {});
  }, []);

  function handleRemarkSaved() {
    toast.success("Remark saved");
    load();
  }

  const counts = useMemo(
    () =>
      rows.reduce((acc, r) => {
        acc[r.category] = (acc[r.category] || 0) + 1;
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
        filterFn: "equalsString",
        cell: ({ row }) => <span className="font-medium">{row.original.lecturer_name}</span>,
      },
      {
        accessorKey: "session_number",
        header: "Session",
        meta: { label: "Session" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap" title={`Session ${row.original.session_number} of ${row.original.sessions_that_day}`}>
            {row.original.session_number}
          </span>
        ),
      },
      {
        accessorKey: "class_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Class" />,
        meta: { label: "Class" },
        filterFn: "equalsString",
      },
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course / subject" />,
        meta: { label: "Course / subject" },
      },
      {
        accessorKey: "scheduled_time",
        header: "Scheduled",
        meta: { label: "Scheduled" },
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() || "—"}</span>,
      },
      { accessorKey: "checkin_at", header: "Check-in", meta: { label: "Check-in" }, cell: ({ getValue }) => getValue() || "--:--" },
      { accessorKey: "checkout_at", header: "Check-out", meta: { label: "Check-out" }, cell: ({ getValue }) => getValue() || "--:--" },
      {
        id: "category",
        accessorKey: "category",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status", exportValue: (r) => r.status_label },
        filterFn: "equalsString",
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={CATEGORIES[row.original.category]?.variant} className="whitespace-nowrap">
              {row.original.status_label}
            </Badge>
            {row.original.flagged_for_review && (
              <Badge variant="outline" className="whitespace-nowrap text-[10px]">
                Review
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: "justification",
        header: "Justification",
        meta: { label: "Justification" },
        cell: ({ getValue }) => getValue() || "",
      },
      {
        id: "remarks",
        accessorFn: (r) => r.remarks || "",
        header: "Remarks",
        enableSorting: false,
        meta: { label: "Remarks" },
        cell: ({ row }) =>
          row.original.absence_id ? (
            <span className="text-xs">{row.original.remarks}</span>
          ) : (
            <RemarksCell record={{ id: row.original.record_id, remarks: row.original.remarks }} onSaved={handleRemarkSaved} />
          ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lecturer daily attendance"
        description={`Every teaching session on ${formatDate(day)}, numbered per lecturer. Justified and unjustified absences are shown separately.`}
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="daily-date" className="text-xs text-muted-foreground">
              Date
            </Label>
            <Input id="daily-date" type="date" value={day} max={todayIso()} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" />
            {day !== todayIso() && (
              <Button variant="outline" size="sm" onClick={() => setDay(todayIso())}>
                Today
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4 text-primary" /> Lecturer check-in QR code (green)
            </CardTitle>
            <CardDescription>For lecturers only. Print it and put it where lecturers arrive. Students who scan it get a warning.</CardDescription>
          </CardHeader>
          <CardContent>
            {qrUrl ? (
              <img src={qrUrl} alt="Lecturer check-in QR code" className="mx-auto w-44 rounded-lg" />
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {SUMMARY_CATEGORIES.map((c) => (
                <div key={c} className="rounded-lg bg-muted/60 px-2 py-2 text-center">
                  <p className="text-xl font-bold">{counts[c] || 0}</p>
                  <Badge variant={CATEGORIES[c].variant} className="mt-1 whitespace-nowrap px-1.5 text-[10px]">
                    {CATEGORIES[c].label}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Counts are per session.</p>
          </CardContent>
        </Card>
      </div>

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => `${r.lecturer_id}-${r.date}-${r.session_number}`}
        searchPlaceholder="Search lecturers, classes or courses..."
        filters={[
          { columnId: "lecturer_name", label: "Lecturer" },
          { columnId: "class_name", label: "Class" },
          {
            columnId: "category",
            label: "Status",
            options: Object.entries(CATEGORIES).map(([value, c]) => ({ value, label: c.label })),
          },
        ]}
        exportName={`lecturer-daily-${day}`}
        emptyText="No classes scheduled on this day."
        pageSize={50}
      />
    </div>
  );
}
