import { useEffect, useMemo, useState } from "react";
import { QrCode } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import StudentSessionRoster from "@/components/StudentSessionRoster.jsx";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function StudentOverview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openSession, setOpenSession] = useState(null);

  useEffect(() => {
    client
      .get("/admin/attendance/students/today")
      .then((res) => setRows(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo(() => {
    const num = (key, title, cls = "") => ({
      accessorKey: key,
      header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
      meta: { label: title },
      cell: ({ getValue }) => <span className={cls}>{getValue()}</span>,
    });
    return [
      {
        id: "time",
        accessorFn: (r) => `${r.start_time} - ${r.end_time || "?"}`,
        header: "Time",
        cell: ({ getValue }) => <span className="whitespace-nowrap font-medium">{getValue()}</span>,
      },
      {
        accessorKey: "batch",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        meta: { label: "Batch" },
        filterFn: "equalsString",
      },
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course" />,
        meta: { label: "Course" },
      },
      {
        accessorKey: "lecturer_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lecturer" />,
        meta: { label: "Lecturer" },
      },
      num("total_students", "Total"),
      num("on_time", "On time", "text-success font-medium"),
      num("late", "Late", "text-warning font-medium"),
      num("absent", "Absent", "text-danger font-medium"),
      num("present_excused", "Excused"),
      num("not_yet", "Not yet", "text-muted-foreground"),
      {
        id: "qr",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-28 text-right" },
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
            <a href={`/class-code?timetable_id=${row.original.timetable_id}`} target="_blank" rel="noreferrer">
              <QrCode /> Show QR
            </a>
          </Button>
        ),
      },
    ];
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today's student sessions"
        description="Select a session to view and adjust its roster. Use Show QR to display a session's check-in QR code and class code, for example if the lecturer can't show it. Each code works only for that session's batch."
      />

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => String(r.timetable_id)}
        searchPlaceholder="Search course, batch or lecturer..."
        filters={[{ columnId: "batch", label: "Batch" }]}
        exportName="student-sessions-today"
        emptyText="No student sessions scheduled today."
        onRowClick={(r) => setOpenSession(r.timetable_id)}
      />

      {openSession && (
        <StudentSessionRoster
          timetableId={openSession}
          date={new Date().toISOString().slice(0, 10)}
          onClose={() => setOpenSession(null)}
        />
      )}
    </div>
  );
}
