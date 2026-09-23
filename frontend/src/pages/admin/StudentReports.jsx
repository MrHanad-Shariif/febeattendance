import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function useStatsColumns(showBatch) {
  return useMemo(() => {
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
      ...(showBatch
        ? [
            {
              accessorKey: "batch",
              header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
              meta: { label: "Batch" },
              filterFn: "equalsString",
            },
          ]
        : []),
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
        id: "retakes",
        accessorFn: (r) => r.courses_needing_retake ?? (r.needs_retake ? 1 : 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Retakes" />,
        meta: { label: "Retakes" },
        cell: ({ getValue }) => (getValue() > 0 ? <Badge variant="danger">{getValue()}</Badge> : <span className="text-muted-foreground">0</span>),
      },
      {
        id: "view",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/admin/students/${row.original.student_id}/report`}>
              <Eye /> View
            </Link>
          </Button>
        ),
      },
    ];
  }, [showBatch]);
}

function PickerSelect({ label, value, onChange, placeholder, options, className }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className={className || "w-64"}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function StudentReports() {
  const [tab, setTab] = useState("class"); // class | course | department
  const [batches, setBatches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [selected, setSelected] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    client.get("/auth/batches").then((res) => setBatches(res.data)).catch(() => {});
    client.get("/admin/departments").then((res) => setDepartments(res.data)).catch(() => {});
    client.get("/admin/courses").then((res) => setCourses(res.data)).catch(() => {});
  }, []);

  async function run(request, name) {
    setLoading(true);
    setError("");
    setTitle(name);
    try {
      const res = await request();
      setRows(res.data.rows);
    } catch (err) {
      setError(apiErrorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function pick(value) {
    setSelected(value);
    if (tab === "class") run(() => client.get(`/admin/reports/class/${encodeURIComponent(value)}`), `Batch ${value}`);
    if (tab === "department") run(() => client.get(`/admin/reports/department/${encodeURIComponent(value)}`), value);
    if (tab === "course") {
      const [batch, courseName] = JSON.parse(value);
      run(() => client.get("/admin/reports/course", { params: { batch, course_name: courseName } }), `${courseName} (${batch})`);
    }
  }

  function switchTab(next) {
    setTab(next);
    setRows([]);
    setSelected("");
    setTitle("");
  }

  const columns = useStatsColumns(tab !== "class");

  return (
    <div className="space-y-6">
      <PageHeader title="Student reports" description="Attendance and retake status for a whole class, course or department." />

      <Card>
        <CardContent className="space-y-4 p-5">
          <Tabs value={tab} onValueChange={switchTab}>
            <TabsList>
              <TabsTrigger value="class">Whole class</TabsTrigger>
              <TabsTrigger value="course">Whole course</TabsTrigger>
              <TabsTrigger value="department">Whole department</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "class" && (
            <PickerSelect label="Batch" value={selected} onChange={pick} placeholder="Select a batch" options={batches.map((b) => ({ value: b, label: b }))} />
          )}
          {tab === "course" && (
            <PickerSelect
              label="Course"
              value={selected}
              onChange={pick}
              placeholder="Select a course"
              className="w-80"
              options={courses.map((c) => ({ value: JSON.stringify([c.batch, c.course_name]), label: `${c.course_name} (${c.batch})` }))}
            />
          )}
          {tab === "department" && (
            <PickerSelect label="Department" value={selected} onChange={pick} placeholder="Select a department" options={departments.map((d) => ({ value: d, label: d }))} />
          )}
        </CardContent>
      </Card>

      {error && <Alert>{error}</Alert>}

      {(loading || rows.length > 0) && (
        <div className="space-y-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            getRowId={(r) => String(r.student_id)}
            searchPlaceholder="Search students..."
            exportName={`student-report-${tab}`}
            pageSize={20}
            emptyText="No results."
          />
        </div>
      )}
    </div>
  );
}
