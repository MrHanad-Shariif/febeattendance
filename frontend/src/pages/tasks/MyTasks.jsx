import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList } from "lucide-react";
import { useApi } from "@/components/committees/shared";
import { TaskTable } from "@/components/committees/tables";
import { Alert, PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";

/** scope="mine": tasks assigned to me. scope="managed": Task Monitoring for
 * every committee I chair. */
export default function MyTasks({ scope = "mine" }) {
  const managed = scope === "managed";
  const { data, loading, error } = useApi(managed ? "/tasks?scope=managed" : "/tasks", []);
  const tasks = data || [];
  const open = tasks.filter((t) => t.status !== "completed");
  const overdue = tasks.filter((t) => t.is_overdue);
  const soon = open.filter((t) => t.deadline && !t.is_overdue && new Date(t.deadline) - Date.now() < 7 * 864e5);

  return (
    <div className="space-y-6">
      <PageHeader
        title={managed ? "Task monitoring" : "My tasks"}
        description={
          managed
            ? "Every task in the committees you chair. Open a task to edit it, change its deadline or reassign it."
            : "Tasks assigned to you across all your committees. Open a task to update progress or mark it completed."
        }
      />
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Open" value={open.length} icon={ClipboardList} loading={loading} index={0} />
        <StatCard title="Due within 7 days" value={soon.length} icon={CalendarClock} tone="warning" loading={loading} index={1} />
        <StatCard title="Overdue" value={overdue.length} icon={AlertTriangle} tone="danger" loading={loading} index={2} />
        <StatCard title="Completed" value={tasks.length - open.length} icon={CheckCircle2} tone="success" loading={loading} index={3} />
      </div>
      <TaskTable
        tasks={tasks}
        loading={loading}
        showAssignee={managed}
        emptyText={managed ? "No tasks in your committees yet." : "No tasks have been assigned to you."}
        exportName={managed ? "committee-tasks" : "my-tasks"}
      />
    </div>
  );
}
