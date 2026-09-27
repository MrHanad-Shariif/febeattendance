import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, CircleDot, FileText, History, Pencil, PlayCircle, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { TaskFormDialog } from "@/components/committees/TaskFormDialog.jsx";
import { DocumentActions, Field, FileInput, InfoRow, PriorityBadge, TaskStatusBadge, useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, toFormData } from "@/lib/committees";

function describeEvent(e) {
  const v = e.new_value;
  switch (e.action) {
    case "assigned":
      return v?.assigned_to ? `to ${v.assigned_to}` : "";
    case "reassigned":
      return `from ${e.old_value || "—"} to ${v}`;
    case "deadline_changed":
      return `from ${formatDateTime(e.old_value)} to ${formatDateTime(v)}`;
    case "status_changed":
    case "reopened":
      return `${e.old_value || "—"} → ${v}`;
    case "edited":
      return v ? `changed ${Object.keys(v).join(", ")}` : "";
    case "file_uploaded":
      return v;
    case "notification_sent":
      if (v?.reminder === "due_soon") return "deadline reminder";
      return v?.to ? `to ${Array.isArray(v.to) ? v.to.join(", ") : v.to}` : "";
    default:
      return "";
  }
}

const REPORT_SECTIONS = [
  ["completion_note", "Work carried out", "What you did to complete the task.", true],
  ["report_outcomes", "Outcomes and results", "What was achieved or delivered.", true],
  ["report_challenges", "Challenges encountered (optional)", "Problems met along the way and how they were handled.", false],
  ["report_recommendations", "Recommendations and next steps (optional)", "Follow-up actions or advice for the committee.", false],
];

function CompleteDialog({ open, onOpenChange, task, onDone }) {
  const [report, setReport] = useState({});
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await client.post(`/tasks/${task.id}/complete`, toFormData({ ...report, files }));
      toast.success("Task completed. Your task report has been generated and the chairperson and secretary notified.");
      onOpenChange(false);
      onDone(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Complete task and submit report</DialogTitle>
            <DialogDescription>
              Your answers are printed on the faculty's standard task report (with the task, dates and deadline filled in
              automatically) and filed in the committee archive.
            </DialogDescription>
          </DialogHeader>
          {REPORT_SECTIONS.map(([key, label, hint, required]) => (
            <Field key={key} label={label} htmlFor={`done-${key}`} hint={hint}>
              <Textarea
                id={`done-${key}`}
                rows={3}
                required={required}
                maxLength={5000}
                value={report[key] || ""}
                onChange={(e) => setReport((r) => ({ ...r, [key]: e.target.value }))}
              />
            </Field>
          ))}
          <Field label="Evidence files (optional)" htmlFor="done-files" hint="PDF, Word, Excel or images, up to 15 MB in total.">
            <FileInput id="done-files" multiple onChange={setFiles} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <CheckCircle2 /> {saving ? "Saving..." : "Complete and submit report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const { data: task, error, reload } = useApi(`/tasks/${id}`);
  const committee = useApi(task?.can_manage ? `/committees/${task.committee_id}` : null);
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  if (error) return <Alert>{error}</Alert>;
  if (!task) return <Skeleton className="h-64 w-full" />;

  async function act(fn, message) {
    setBusy(true);
    try {
      const res = await fn();
      if (message) toast.success(message);
      reload();
      return res;
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const completed = task.status === "completed";

  return (
    <div className="space-y-6">
      <PageHeader
        title={task.title}
        description={
          <>
            <Link to={`/committees/${task.committee_id}`} className="text-primary hover:underline">
              {task.committee_name}
            </Link>{" "}
            · assigned by {task.assigned_by_name || "—"} on {formatDateTime(task.assigned_at)}
          </>
        }
        actions={
          <>
            {task.can_work && !completed && task.status === "pending" && (
              <Button variant="outline" disabled={busy} onClick={() => act(() => client.post(`/tasks/${task.id}/status`, { status: "in_progress" }), "Marked in progress")}>
                <PlayCircle /> Start
              </Button>
            )}
            {task.can_work && !completed && (
              <Button onClick={() => setCompleteOpen(true)}>
                <CheckCircle2 /> Mark completed
              </Button>
            )}
            {task.can_manage && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil /> Edit / reassign
              </Button>
            )}
            {task.can_manage && completed && (
              <Button variant="outline" disabled={busy} onClick={() => act(() => client.put(`/tasks/${task.id}`, { status: "in_progress" }), "Task reopened")}>
                <RotateCcw /> Reopen
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <InfoRow label="Status">
                  <TaskStatusBadge status={task.display_status} />
                </InfoRow>
                <InfoRow label="Priority">
                  <PriorityBadge priority={task.priority} />
                </InfoRow>
                <InfoRow label="Assigned to">{task.assigned_to_name}</InfoRow>
                <InfoRow label="Deadline">
                  <span className={task.is_overdue ? "font-medium text-danger" : undefined}>{formatDateTime(task.deadline)}</span>
                </InfoRow>
                <InfoRow label="Description">
                  <span className="whitespace-pre-wrap">{task.description}</span>
                </InfoRow>
                {completed && (
                  <>
                    <InfoRow label="Completed">
                      {formatDateTime(task.completed_at)} by {task.completed_by_name}
                    </InfoRow>
                    <InfoRow label="Work carried out">
                      <span className="whitespace-pre-wrap">{task.completion_note}</span>
                    </InfoRow>
                    {task.report_outcomes && (
                      <InfoRow label="Outcomes">
                        <span className="whitespace-pre-wrap">{task.report_outcomes}</span>
                      </InfoRow>
                    )}
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          {task.report && (
            <Card className="border-primary/40">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-primary" /> Task report
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ref. {task.report.reference_no} · filed in the committee archive
                  </p>
                </div>
                <DocumentActions url={task.report.url} fileName={task.report.file_name} showName={false} />
              </CardHeader>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Files ({task.attachments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {task.attachments.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.uploaded_by_name} · {formatDateTime(a.uploaded_at)}
                    </p>
                  </div>
                  <DocumentActions url={a.url} fileName={a.file_name} showName={false} />
                </div>
              ))}
              {task.attachments.length === 0 && <p className="text-sm text-muted-foreground">No files uploaded.</p>}
              {(task.can_work || task.can_manage) && (
                <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                  <div className="min-w-[220px] flex-1">
                    <FileInput id="task-upload" multiple onChange={setUploadFiles} />
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy || uploadFiles.length === 0}
                    onClick={() => act(() => client.post(`/tasks/${task.id}/attachments`, toFormData({ files: uploadFiles })), "File uploaded")}
                  >
                    <Upload /> Upload
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l pl-5">
              {task.history.map((e) => (
                <li key={e.id} className="relative">
                  <CircleDot className="absolute -left-[27px] top-0.5 h-4 w-4 bg-card text-primary" />
                  <p className="text-sm font-medium">
                    {e.action_label} <span className="font-normal text-muted-foreground">{describeEvent(e)}</span>
                  </p>
                  {e.note && <p className="text-xs italic text-muted-foreground">“{e.note}”</p>}
                  <p className="text-xs text-muted-foreground">
                    {e.actor_name} · {formatDateTime(e.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <CompleteDialog open={completeOpen} onOpenChange={setCompleteOpen} task={task} onDone={reload} />
      {task.can_manage && (
        <TaskFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          task={task}
          members={committee.data?.members || []}
          onSaved={reload}
        />
      )}
    </div>
  );
}
