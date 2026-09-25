import { Link } from "react-router-dom";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, FileBarChart, Network } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/committees";

/** The Dean's faculty-level view of every committee (brief items 38 and 43). */
export default function FacultyOverview() {
  const { data, loading, error } = useApi("/faculty/overview");
  const t = data?.totals || {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty overview"
        description="Activity across all faculty committees and the Administration Team."
        actions={
          <Button variant="outline" asChild>
            <Link to="/committee-reports?type=faculty_overview">
              <FileBarChart /> Faculty committee report
            </Link>
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard title="Committees" value={t.committees ?? 0} icon={Network} loading={loading} index={0} />
        <StatCard title="Open tasks" value={t.pending ?? 0} icon={ClipboardList} tone="info" loading={loading} index={1} />
        <StatCard title="Completed tasks" value={t.completed ?? 0} icon={CheckCircle2} tone="success" loading={loading} index={2} />
        <StatCard title="Overdue tasks" value={t.overdue ?? 0} icon={AlertTriangle} tone="danger" loading={loading} index={3} />
        <StatCard title="Upcoming meetings" value={t.upcoming_meetings ?? 0} icon={CalendarDays} tone="purple" loading={loading} index={4} />
      </div>

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task progress by committee</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.committees} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="task_completed" name="Completed" stackId="a" fill="hsl(var(--success))" />
                  <Bar dataKey="task_pending" name="Open" stackId="a" fill="hsl(var(--info))" />
                  <Bar dataKey="task_overdue" name="Overdue" fill="hsl(var(--danger))" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Committees</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Committee</TableHead>
                    <TableHead>Chairperson</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead className="text-right">Meetings held</TableHead>
                    <TableHead className="text-right">Upcoming</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.committees.map((c) => (
                    <TableRow key={c.committee_id}>
                      <TableCell>
                        <Link to={`/committees/${c.committee_id}`} className="font-medium text-primary hover:underline">
                          {c.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{c.kind_label}</p>
                      </TableCell>
                      <TableCell>{c.chairperson_name}</TableCell>
                      <TableCell className="text-right">{c.member_count}</TableCell>
                      <TableCell className="text-right">{c.task_total}</TableCell>
                      <TableCell className="text-right">{c.task_completed}</TableCell>
                      <TableCell className={`text-right ${c.task_overdue ? "font-semibold text-danger" : ""}`}>{c.task_overdue}</TableCell>
                      <TableCell className="text-right">{c.meetings_held}</TableCell>
                      <TableCell className="text-right">{c.upcoming_meetings}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overdue tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.overdue_tasks.map((task) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="block rounded-lg border p-2 hover:bg-muted/50">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-danger">
                      {task.assigned_to_name} · due {formatDateTime(task.deadline)}
                    </p>
                  </Link>
                ))}
                {data.overdue_tasks.length === 0 && <p className="text-sm text-muted-foreground">No overdue tasks.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Upcoming meetings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.upcoming_meetings.map((m) => (
                  <Link key={m.id} to={`/meetings/${m.id}`} className="block rounded-lg border p-2 hover:bg-muted/50">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.committee_name} · {formatDate(m.date)} {m.start_time || ""}
                    </p>
                  </Link>
                ))}
                {data.upcoming_meetings.length === 0 && <p className="text-sm text-muted-foreground">No meetings scheduled.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recently published minutes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.recent_minutes.map((m) => (
                  <Link key={m.id} to={`/meeting-minutes/${m.id}`} className="block rounded-lg border p-2 hover:bg-muted/50">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.committee_name} · released {formatDate(m.published_at)}
                    </p>
                  </Link>
                ))}
                {data.recent_minutes.length === 0 && <p className="text-sm text-muted-foreground">No minutes yet.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
