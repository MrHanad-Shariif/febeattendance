import { useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import StudentCourseSessionsModal from "@/components/StudentCourseSessionsModal.jsx";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function LecturerStudentAttendance() {
  const [courses, setCourses] = useState([]);
  const [selected, setSelected] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openStudent, setOpenStudent] = useState(null); // { studentId, studentName }

  useEffect(() => {
    client.get("/me/student-courses").then((res) => setCourses(res.data)).catch(() => {});
  }, []);

  function handleSelect(value) {
    setSelected(value);
    setRows([]);
    setError("");
    const [batch, courseName] = JSON.parse(value);
    setLoading(true);
    client
      .get("/me/student-course-report", { params: { batch, course_name: courseName } })
      .then((res) => setRows(res.data.rows))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  const [selectedBatch, selectedCourse] = selected ? JSON.parse(selected) : [null, null];

  const columns = useMemo(() => {
    const num = (key, title, cls = "") => ({
      accessorKey: key,
      header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
      meta: { label: title },
      cell: ({ getValue }) => <span className={cls}>{getValue()}</span>,
    });
    return [
      {
        accessorKey: "student_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Student" />,
        meta: { label: "Student" },
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      },
      { accessorKey: "student_id_number", header: "ID", meta: { label: "ID" } },
      {
        id: "held",
        accessorFn: (r) => `${r.sessions_held} / ${r.total_sessions}`,
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
        accessorFn: (r) => (r.needs_retake ? "Retake" : "On track"),
        header: "Status",
        filterFn: "equalsString",
        cell: ({ getValue }) => <Badge variant={getValue() === "Retake" ? "danger" : "success"}>{getValue()}</Badge>,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpenStudent({ studentId: row.original.student_id, studentName: row.original.student_name })}
          >
            <Eye /> Sessions
          </Button>
        ),
      },
    ];
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My students"
        description="Pick one of your courses to see attendance for every student in it. Open a student to review or correct a specific session."
      />

      <Card>
        <CardContent className="space-y-1.5 p-5">
          <Label>Course</Label>
          <Select value={selected || undefined} onValueChange={handleSelect}>
            <SelectTrigger className="w-full sm:w-96">
              <SelectValue placeholder="Select a course" />
            </SelectTrigger>
            <SelectContent>
              {courses.map((c) => (
                <SelectItem key={`${c.batch}|${c.course_name}`} value={JSON.stringify([c.batch, c.course_name])}>
                  {c.course_name} ({c.batch})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {error && <Alert>{error}</Alert>}

      {selected && (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          getRowId={(r) => String(r.student_id)}
          searchPlaceholder="Search students..."
          filters={[
            {
              columnId: "status",
              label: "Status",
              options: [
                { value: "Retake", label: "Retake" },
                { value: "On track", label: "On track" },
              ],
            },
          ]}
          exportName="my-students"
          pageSize={20}
          emptyText="No students found in this batch yet."
        />
      )}

      {openStudent && (
        <StudentCourseSessionsModal
          batch={selectedBatch}
          courseName={selectedCourse}
          studentId={openStudent.studentId}
          studentName={openStudent.studentName}
          onClose={() => setOpenStudent(null)}
          apiBase="/me"
        />
      )}
    </div>
  );
}
