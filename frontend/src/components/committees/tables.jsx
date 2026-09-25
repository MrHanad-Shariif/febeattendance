import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { KIND_OPTIONS, MEETING_STATUS, PRIORITIES, TASK_STATUS, formatDate, formatDateTime } from "@/lib/committees";
import { MeetingStatusBadge, PriorityBadge, TaskStatusBadge } from "./shared";

const header = (title) => ({ column }) => <DataTableColumnHeader column={column} title={title} />;
const toOptions = (map) => Object.entries(map).map(([value, v]) => ({ value, label: v.label }));

/** Task list with the brief's filters: committee, member, status, priority. */
export function TaskTable({ tasks, loading, showCommittee = true, showAssignee = true, toolbar, emptyText, exportName = "tasks" }) {
  const navigate = useNavigate();
  const columns = useMemo(
    () =>
      [
        {
          accessorKey: "title",
          header: header("Task"),
          meta: { label: "Task" },
          cell: ({ row }) => (
            <div className="min-w-[180px]">
              <p className="font-medium">{row.original.title}</p>
              {row.original.attachment_count > 0 && (
                <p className="text-xs text-muted-foreground">{row.original.attachment_count} file(s)</p>
              )}
            </div>
          ),
        },
        showCommittee && {
          accessorKey: "committee_name",
          header: header("Committee"),
          meta: { label: "Committee" },
          filterFn: exactFilter,
        },
        showAssignee && {
          accessorKey: "assigned_to_name",
          header: header("Member"),
          meta: { label: "Member" },
          filterFn: exactFilter,
        },
        {
          accessorKey: "assigned_at",
          header: header("Assigned"),
          meta: { label: "Assigned", exportValue: (r) => formatDate(r.assigned_at) },
          cell: ({ row }) => formatDate(row.original.assigned_at),
        },
        {
          accessorKey: "deadline",
          header: header("Deadline"),
          meta: { label: "Deadline", exportValue: (r) => formatDateTime(r.deadline) },
          sortUndefined: "last",
          cell: ({ row }) => (
            <span className={row.original.is_overdue ? "flex items-center gap-1 font-medium text-danger" : undefined}>
              {row.original.is_overdue && <AlertTriangle className="h-3.5 w-3.5" />}
              {formatDateTime(row.original.deadline)}
            </span>
          ),
        },
        {
          accessorKey: "priority",
          header: header("Priority"),
          meta: { label: "Priority" },
          filterFn: exactFilter,
          cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
        },
        {
          accessorKey: "display_status",
          header: header("Status"),
          meta: { label: "Status", exportValue: (r) => r.status_label },
          filterFn: exactFilter,
          cell: ({ row }) => <TaskStatusBadge status={row.original.display_status} />,
        },
        {
          accessorKey: "completed_at",
          header: header("Completed"),
          meta: { label: "Completed", exportValue: (r) => formatDateTime(r.completed_at) },
          cell: ({ row }) => (row.original.completed_at ? formatDateTime(row.original.completed_at) : "—"),
        },
      ].filter(Boolean),
    [showCommittee, showAssignee]
  );

  const filters = [
    { columnId: "display_status", label: "Status", options: toOptions(TASK_STATUS) },
    { columnId: "priority", label: "Priority", options: PRIORITIES },
    showCommittee && { columnId: "committee_name", label: "Committee" },
    showAssignee && { columnId: "assigned_to_name", label: "Member" },
  ].filter(Boolean);

  return (
    <DataTable
      columns={columns}
      data={tasks || []}
      loading={loading}
      getRowId={(r) => String(r.id)}
      searchPlaceholder="Search tasks..."
      filters={filters}
      toolbar={toolbar}
      exportName={exportName}
      onRowClick={(t) => navigate(`/tasks/${t.id}`)}
      initialSorting={[{ id: "deadline", desc: false }]}
      initialVisibility={{ completed_at: false }}
      emptyText={emptyText || "No tasks yet."}
    />
  );
}

export function MeetingTable({ meetings, loading, showCommittee = true, toolbar, emptyText }) {
  const navigate = useNavigate();
  const columns = useMemo(
    () =>
      [
        { accessorKey: "title", header: header("Meeting"), meta: { label: "Meeting" }, cell: ({ row }) => <span className="font-medium">{row.original.title}</span> },
        showCommittee && { accessorKey: "committee_name", header: header("Committee"), meta: { label: "Committee" }, filterFn: exactFilter },
        { accessorKey: "meeting_type", header: header("Type"), meta: { label: "Type" }, filterFn: exactFilter },
        {
          accessorKey: "date",
          header: header("Date"),
          meta: { label: "Date" },
          cell: ({ row }) => (
            <span>
              {formatDate(row.original.date)}
              {row.original.start_time && <span className="text-muted-foreground"> · {row.original.start_time}{row.original.end_time && `–${row.original.end_time}`}</span>}
            </span>
          ),
        },
        { accessorKey: "location", header: header("Location"), meta: { label: "Location" }, cell: ({ row }) => row.original.location || "—" },
        {
          accessorKey: "status",
          header: header("Status"),
          meta: { label: "Status" },
          filterFn: exactFilter,
          cell: ({ row }) => <MeetingStatusBadge status={row.original.status} />,
        },
        {
          id: "minutes",
          accessorFn: (r) => (r.minutes_id ? "Published" : "—"),
          header: "Minutes",
          meta: { label: "Minutes" },
        },
      ].filter(Boolean),
    [showCommittee]
  );
  return (
    <DataTable
      columns={columns}
      data={meetings || []}
      loading={loading}
      getRowId={(r) => String(r.id)}
      searchPlaceholder="Search meetings..."
      filters={[
        showCommittee && { columnId: "committee_name", label: "Committee" },
        { columnId: "meeting_type", label: "Type" },
        { columnId: "status", label: "Status", options: toOptions(MEETING_STATUS) },
      ].filter(Boolean)}
      toolbar={toolbar}
      exportName="meetings"
      onRowClick={(m) => navigate(`/meetings/${m.id}`)}
      initialSorting={[{ id: "date", desc: true }]}
      emptyText={emptyText || "No meetings yet."}
    />
  );
}

export function MinutesTable({ minutes, loading, toolbar, showCommittee = true }) {
  const navigate = useNavigate();
  const columns = useMemo(
    () =>
      [
        { accessorKey: "title", header: header("Meeting"), meta: { label: "Meeting" }, cell: ({ row }) => <span className="font-medium">{row.original.title}</span> },
        showCommittee && { accessorKey: "committee_name", header: header("Committee / unit"), meta: { label: "Committee" } },
        {
          accessorKey: "committee_kind",
          header: header("Unit type"),
          meta: { label: "Unit type", exportValue: (r) => r.unit_label },
          cell: ({ row }) => KIND_OPTIONS.find((k) => k.value === row.original.committee_kind)?.label,
        },
        { accessorKey: "meeting_date", header: header("Meeting date"), meta: { label: "Meeting date" }, cell: ({ row }) => formatDate(row.original.meeting_date) },
        { accessorKey: "published_at", header: header("Released"), meta: { label: "Released", exportValue: (r) => formatDateTime(r.published_at) }, cell: ({ row }) => formatDateTime(row.original.published_at) },
        { accessorKey: "visibility", header: header("Visibility"), meta: { label: "Visibility" }, cell: ({ row }) => (row.original.visibility === "faculty" ? "Faculty-wide" : "Committee") },
      ].filter(Boolean),
    [showCommittee]
  );
  return (
    <DataTable
      columns={columns}
      data={minutes || []}
      loading={loading}
      getRowId={(r) => String(r.id)}
      toolbar={toolbar}
      exportName="meeting-minutes"
      onRowClick={(m) => navigate(`/meeting-minutes/${m.id}`)}
      initialSorting={[{ id: "meeting_date", desc: true }]}
      emptyText="No minutes have been published yet."
    />
  );
}
