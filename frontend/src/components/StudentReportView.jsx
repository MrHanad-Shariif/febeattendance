import { useMemo, useState } from "react";
import { AuthImage } from "@/components/auth-image";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import StatusBadge from "./StatusBadge.jsx";

function RetakeBadge({ retake }) {
  return retake ? <Badge variant="danger">Retake</Badge> : <Badge variant="success">On track</Badge>;
}

export default function StudentReportView({ report }) {
  const [mode, setMode] = useState("summary"); // summary | detailed
  const { basic_info: info, summary, detailed, totals } = report;

  const columns = useMemo(() => {
    const num = (key, title, cls = "") => ({
      accessorKey: key,
      header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
      meta: { label: title },
      cell: ({ getValue }) => <span className={cls}>{getValue()}</span>,
    });
    return [
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course" />,
        meta: { label: "Course" },
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      },
      {
        id: "held",
        accessorFn: (c) => `${c.sessions_held} / ${c.total_sessions}`,
        header: "Held / total",
      },
      num("on_time", "On time", "text-success font-medium"),
      num("late", "Late", "text-warning font-medium"),
      num("absent", "Absent", "text-danger font-medium"),
      num("present_excused", "Excused"),
      {
        accessorKey: "absence_percentage",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Absence %" />,
        meta: { label: "Absence %" },
        cell: ({ getValue }) => `${getValue()}%`,
      },
      {
        id: "status",
        accessorFn: (c) => (c.needs_retake ? "Retake" : "On track"),
        header: "Status",
        cell: ({ row }) => <RetakeBadge retake={row.original.needs_retake} />,
      },
    ];
  }, []);

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <AuthImage
            src={info.photo_url}
            alt={info.name}
            className="h-20 w-20 rounded-xl object-cover"
            fallback={
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-primary/10 text-2xl font-semibold text-primary">
                {info.name?.[0] || "?"}
              </div>
            }
          />
          <div className="space-y-0.5">
            <p className="text-lg font-semibold">{info.name}</p>
            <p className="text-sm text-muted-foreground">ID: {info.student_id_number}</p>
            <p className="text-sm text-muted-foreground">{info.faculty}</p>
            <p className="text-sm text-muted-foreground">
              {info.department} · {info.batch}
            </p>
            <p className="text-sm text-muted-foreground">{info.email}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall sessions</p>
          <p className="text-3xl font-bold">{totals.sessions_held}</p>
          <p className="text-xs text-muted-foreground">
            {totals.on_time} on time · {totals.late} late · {totals.absent} absent · {totals.present_excused} excused
          </p>
        </div>
      </Card>

      <Tabs value={mode} onValueChange={setMode} className="print:hidden">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="detailed">Detailed</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "summary" ? (
        <DataTable columns={columns} data={summary} getRowId={(c) => c.course_name} exportName="student-report" emptyText="No courses yet." pageSize={20} />
      ) : (
        <div className="space-y-4">
          {detailed.map((c) => (
            <Card key={c.course_name} className="p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{c.course_name}</p>
                {c.needs_retake && <Badge variant="danger">Needs retake</Badge>}
              </div>
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-4">Date</th>
                    <th className="py-1.5 pr-4">Status</th>
                    <th className="py-1.5">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {c.sessions.map((s, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-2 pr-4">{s.date}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={s.status} label={s.status_label} />
                      </td>
                      <td className="py-2 text-muted-foreground">{s.remarks || "—"}</td>
                    </tr>
                  ))}
                  {c.sessions.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-center text-muted-foreground">
                        No sessions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          ))}
          {detailed.length === 0 && <p className="text-sm text-muted-foreground">No courses yet.</p>}
        </div>
      )}
    </div>
  );
}
