import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, CalendarPlus, ClipboardPlus, Crown, FileBarChart, PenLine, Pencil, ScrollText, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { CommitteeFormDialog, staffOptions, useStaff } from "@/components/committees/CommitteeFormDialog.jsx";
import { MeetingFormDialog } from "@/components/committees/MeetingFormDialog.jsx";
import { TaskFormDialog } from "@/components/committees/TaskFormDialog.jsx";
import { OptionSelect, useApi } from "@/components/committees/shared";
import { MeetingTable, MinutesTable, TaskTable } from "@/components/committees/tables";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/committees";
import { initials } from "@/lib/utils";

const ROLE_LABELS = { chairperson: "Chairperson", secretary: "Secretary", member: "Member" };

function Members({ committee, onChanged }) {
  const staff = useStaff(committee.can_edit);
  const [newMember, setNewMember] = useState("");
  const [toRemove, setToRemove] = useState(null);
  const memberIds = new Set(committee.members.map((m) => m.user_id));

  async function run(promise, message) {
    try {
      await promise;
      toast.success(message);
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Members ({committee.members.length})</CardTitle>
        {committee.can_edit && (
          <div className="flex w-full gap-2 sm:w-auto">
            <OptionSelect
              value={newMember}
              onChange={setNewMember}
              placeholder="Add a staff member..."
              options={staffOptions(staff.filter((u) => !memberIds.has(u.id)))}
              className="sm:w-64"
            />
            <Button
              disabled={!newMember}
              onClick={() =>
                run(client.post(`/committees/${committee.id}/members`, { user_id: Number(newMember) }), "Member added").then(() =>
                  setNewMember("")
                )
              }
            >
              <UserPlus /> Add
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="divide-y p-0">
        {committee.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(m.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {m.email} · joined {formatDate(m.joined_at)}
              </p>
            </div>
            {m.role === "chairperson" ? (
              <Badge variant="warning" className="gap-1">
                <Crown className="h-3 w-3" /> Chairperson
              </Badge>
            ) : m.role === "secretary" ? (
              <Badge variant="info" className="gap-1">
                <PenLine className="h-3 w-3" /> Secretary
              </Badge>
            ) : (
              <Badge variant="muted">Member</Badge>
            )}
            {committee.can_edit && (
              <div className="flex gap-1">
                {m.role !== "chairperson" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(client.put(`/committees/${committee.id}`, { chairperson_id: m.user_id }), `${m.name} is now chairperson`)
                    }
                  >
                    <Crown /> Make chair
                  </Button>
                )}
                {m.role === "member" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(client.put(`/committees/${committee.id}`, { secretary_id: m.user_id }), `${m.name} is now secretary`)
                    }
                  >
                    <PenLine /> Make secretary
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Remove member" onClick={() => setToRemove(m)}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        ))}
        {committee.members.length === 0 && <p className="px-6 py-8 text-center text-sm text-muted-foreground">No members yet.</p>}
      </CardContent>
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={`Remove ${toRemove?.name}?`}
        description="Their tasks stay on record. A removed chairperson or secretary loses task-management authority for this committee."
        confirmLabel="Remove"
        onConfirm={() => run(client.delete(`/committees/${committee.id}/members/${toRemove.user_id}`), "Member removed")}
      />
    </Card>
  );
}

export default function CommitteeDetail() {
  const { id } = useParams();
  const committee = useApi(`/committees/${id}`);
  const tasks = useApi(`/committees/${id}/tasks`, []);
  const meetings = useApi(`/meetings?committee_id=${id}`, []);
  const minutes = useApi(`/minutes?committee_id=${id}`, []);
  const [taskOpen, setTaskOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const c = committee.data;
  if (committee.error) return <Alert>{committee.error}</Alert>;
  if (!c) return <Skeleton className="h-64 w-full" />;

  const refreshAll = () => {
    committee.reload();
    tasks.reload();
    meetings.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            {c.kind === "administration" && <Badge variant="purple">Administration Team</Badge>}
            {c.status === "archived" && <Badge variant="muted">Archived</Badge>}
          </span>
        }
        description={
          <>
            Chairperson: <strong>{c.chairperson_name || "not assigned"}</strong> · Secretary:{" "}
            <strong>{c.secretary_name || "not assigned"}</strong>
            {c.my_role && <> · Your role: {ROLE_LABELS[c.my_role] || c.my_role}</>}
            {c.description && <span className="mt-1 block">{c.description}</span>}
          </>
        }
        actions={
          <>
            {c.can_manage_tasks && (
              <Button onClick={() => setTaskOpen(true)}>
                <ClipboardPlus /> Assign task
              </Button>
            )}
            {c.can_schedule_meeting && (
              <Button variant="outline" onClick={() => setMeetingOpen(true)}>
                <CalendarPlus /> Schedule meeting
              </Button>
            )}
            {c.can_view_archive && (
              <Button variant="outline" asChild>
                <Link to={`/archive?committee=${c.id}`}>
                  <Archive /> Archive
                </Link>
              </Button>
            )}
            {c.can_view_reports && (
              <Button variant="outline" asChild>
                <Link to={`/committee-reports?type=committee_tasks&committee_id=${c.id}`}>
                  <FileBarChart /> Reports
                </Link>
              </Button>
            )}
            {c.can_edit && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard title="Tasks" value={c.task_total} index={0} />
        <StatCard title="Completed" value={c.task_completed} tone="success" index={1} />
        <StatCard title="Pending" value={c.task_pending} tone="info" index={2} />
        <StatCard title="Overdue" value={c.task_overdue} tone="danger" index={3} />
        <StatCard title="Upcoming meetings" value={c.upcoming_meetings} tone="purple" index={4} />
      </div>

      <Tabs defaultValue="tasks">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="tasks">{c.can_manage_tasks || !c.my_role || c.my_role !== "member" ? "Tasks" : "My tasks"}</TabsTrigger>
          <TabsTrigger value="sow">Scope of work</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="minutes">Minutes</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks">
          <TaskTable tasks={tasks.data} loading={tasks.loading} showCommittee={false} exportName={`${c.name}-tasks`} />
        </TabsContent>
        <TabsContent value="sow">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ScrollText className="h-4 w-4 text-primary" /> Scope of work
              </CardTitle>
              {c.can_edit && (
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {c.scope_of_work ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.scope_of_work}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No scope of work has been written for this committee yet.
                  {c.can_edit ? " Use Edit to add its mandate, duties and deliverables." : ""}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="members">
          <Members committee={c} onChanged={committee.reload} />
        </TabsContent>
        <TabsContent value="meetings">
          <MeetingTable meetings={meetings.data} loading={meetings.loading} showCommittee={false} />
        </TabsContent>
        <TabsContent value="minutes">
          <MinutesTable minutes={minutes.data} loading={minutes.loading} showCommittee={false} />
        </TabsContent>
      </Tabs>

      <TaskFormDialog open={taskOpen} onOpenChange={setTaskOpen} committeeId={c.id} members={c.members} onSaved={refreshAll} />
      <MeetingFormDialog open={meetingOpen} onOpenChange={setMeetingOpen} committeeId={c.id} onSaved={refreshAll} />
      <CommitteeFormDialog open={editOpen} onOpenChange={setEditOpen} committee={c} onSaved={committee.reload} />
    </div>
  );
}
