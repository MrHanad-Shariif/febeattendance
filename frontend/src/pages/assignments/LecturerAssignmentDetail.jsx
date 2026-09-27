import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, Clock, MessageSquare, MoreHorizontal, Pencil, Timer, Trash2, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, toFormData, toLocalInput } from "@/lib/committees";
import { DeadlineBadge, FileRow, defaultDeadline } from "./shared";

function EditDialog({ open, onOpenChange, assignment, onSaved }) {
  const [form, setForm] = useState({});
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ title: assignment.title, instructions: assignment.instructions || "", deadline: toLocalInput(assignment.deadline) });
      setFile(null);
    }
  }, [open, assignment]);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      // JSON unless a new brief is attached, so clearing the instructions is saved too.
      await client.put(`/assignments/${assignment.id}`, file ? toFormData({ ...form, file }) : form);
      toast.success("Assignment updated");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit assignment</DialogTitle>
            <DialogDescription>
              Moving the deadline later gives the whole class more time (and re-opens a closed assignment). To give
              only some students extra time, use "Give extra time" on their row instead.
            </DialogDescription>
          </DialogHeader>
          <Field label="Title" htmlFor="ed-title">
            <Input id="ed-title" required maxLength={255} value={form.title || ""} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <Field label="Instructions" htmlFor="ed-instr">
            <Textarea id="ed-instr" rows={5} maxLength={20000} value={form.instructions || ""} onChange={(e) => set("instructions")(e.target.value)} />
          </Field>
          <Field label="Deadline for everyone" htmlFor="ed-deadline">
            <Input id="ed-deadline" type="datetime-local" required value={form.deadline || ""} onChange={(e) => set("deadline")(e.target.value)} />
          </Field>
          <Field label="Replace the brief (optional)" htmlFor="ed-file">
            <Input id="ed-file" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="cursor-pointer" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExtensionDialog({ row, assignment, onOpenChange, onSaved }) {
  const [deadline, setDeadline] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (row) {
      setDeadline(row.extension ? toLocalInput(row.extension.deadline) : defaultDeadline(2, assignment.deadline));
      setReason(row.extension?.reason || "");
    }
  }, [row, assignment.deadline]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await client.post(`/assignments/${assignment.id}/extensions`, { student_id: row.student_id, deadline, reason });
      toast.success(`Extra time given to ${row.student_name}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Give extra time</DialogTitle>
            <DialogDescription>
              {row?.student_name} may submit until this new deadline. Everyone else keeps {formatDateTime(assignment.deadline)}.
            </DialogDescription>
          </DialogHeader>
          <Field label="New deadline for this student" htmlFor="ext-deadline">
            <Input id="ext-deadline" type="datetime-local" required value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
          <Field label="Reason (optional)" htmlFor="ext-reason">
            <Input id="ext-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Timer /> {saving ? "Saving..." : "Give extra time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommentDialog({ row, onOpenChange, onSaved }) {
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (row) setComment(row.submission?.lecturer_comment || "");
  }, [row]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await client.put(`/assignments/submissions/${row.submission.id}/comment`, { comment });
      toast.success("Comment saved. The student can see it now.");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Comment for {row?.student_name}</DialogTitle>
            <DialogDescription>Feedback on this submission. The student sees it on their assignment page.</DialogDescription>
          </DialogHeader>
          {row?.submission?.note && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground">Student's note</p>
              <p className="whitespace-pre-wrap">{row.submission.note}</p>
            </div>
          )}
          <div className="space-y-2">
            {row?.submission?.files.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </div>
          <Field label="Your comment" htmlFor="cm-text">
            <Textarea id="cm-text" rows={5} maxLength={5000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <MessageSquare /> {saving ? "Saving..." : "Save comment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function LecturerAssignmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: a, error, reload } = useApi(`/assignments/${id}`);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [extensionRow, setExtensionRow] = useState(null);
  const [commentRow, setCommentRow] = useState(null);

  async function revokeExtension(row) {
    try {
      await client.delete(`/assignments/${id}/extensions/${row.student_id}`);
      toast.success("Extra time removed");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: "student_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Student" />,
        meta: { label: "Student" },
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.student_name}</p>
            <p className="text-xs text-muted-foreground">{row.original.student_id_number}</p>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (r) => (r.submitted ? "Submitted" : r.open ? "Not yet" : "Missing"),
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) =>
          row.original.submitted ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Submitted
            </Badge>
          ) : row.original.open ? (
            <Badge variant="muted">Not yet</Badge>
          ) : (
            <Badge variant="danger" className="gap-1">
              <XCircle className="h-3 w-3" /> Missing
            </Badge>
          ),
      },
      {
        id: "submitted_at",
        accessorFn: (r) => r.submission?.updated_at || "",
        header: "Last upload",
        meta: { label: "Last upload", exportValue: (r) => formatDateTime(r.submission?.updated_at) },
        cell: ({ row }) =>
          row.original.submitted ? (
            <span className="whitespace-nowrap text-sm">
              {formatDateTime(row.original.submission.updated_at)}
              {row.original.late && <span className="block text-xs text-warning">during extra time</span>}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "files",
        accessorFn: (r) => (r.submission?.files || []).map((f) => f.file_name).join("; "),
        header: "Files",
        meta: { label: "Files" },
        cell: ({ row }) => (
          <div className="min-w-[180px] max-w-xs space-y-1">
            {(row.original.submission?.files || []).map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </div>
        ),
      },
      {
        id: "deadline",
        accessorFn: (r) => r.deadline,
        header: "Deadline",
        meta: { label: "Deadline", exportValue: (r) => formatDateTime(r.deadline) },
        cell: ({ row }) =>
          row.original.extension ? (
            <span className="whitespace-nowrap text-sm">
              <Badge variant="info" className="mb-0.5 gap-1">
                <Timer className="h-3 w-3" /> Extra time
              </Badge>
              <span className="block">{formatDateTime(row.original.deadline)}</span>
            </span>
          ) : (
            <span className="whitespace-nowrap text-sm text-muted-foreground">Class deadline</span>
          ),
      },
      {
        id: "comment",
        accessorFn: (r) => r.submission?.lecturer_comment || "",
        header: "Your comment",
        meta: { label: "Comment" },
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-[220px] text-sm text-muted-foreground">{row.original.submission?.lecturer_comment || "—"}</span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {row.original.submission && (
                <DropdownMenuItem onSelect={() => setCommentRow(row.original)}>
                  <MessageSquare /> {row.original.submission.lecturer_comment ? "Edit comment" : "Comment"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setExtensionRow(row.original)}>
                <Timer /> {row.original.extension ? "Change extra time" : "Give extra time"}
              </DropdownMenuItem>
              {row.original.extension && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => revokeExtension(row.original)}>
                    <XCircle /> Remove extra time
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  if (error) return <Alert>{error}</Alert>;
  if (!a) return <Skeleton className="h-64 w-full" />;

  const submitted = a.roster.filter((r) => r.submitted).length;
  const extensions = a.roster.filter((r) => r.extension).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.title}
        description={`${a.course_name} · ${a.batch} · deadline ${formatDateTime(a.deadline)}`}
        actions={
          <>
            <DeadlineBadge iso={a.deadline} />
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit / extend deadline
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 /> Delete
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Students" value={a.roster.length} icon={Users} index={0} />
        <StatCard title="Submitted" value={submitted} icon={CheckCircle2} tone="success" index={1} />
        <StatCard title="Not submitted" value={a.roster.length - submitted} icon={Clock} tone="danger" index={2} />
        <StatCard title="With extra time" value={extensions} icon={CalendarClock} tone="info" index={3} />
      </div>

      {(a.instructions || a.file_url) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {a.instructions && <p className="whitespace-pre-wrap text-sm">{a.instructions}</p>}
            {a.file_url && <FileRow file={{ file_name: a.file_name, url: a.file_url }} />}
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={a.roster}
        getRowId={(r) => String(r.student_id)}
        searchPlaceholder="Search student..."
        exportName={`${a.title}-submissions`}
        emptyText={`No active students are registered in ${a.batch}.`}
      />

      <EditDialog open={editOpen} onOpenChange={setEditOpen} assignment={a} onSaved={reload} />
      <ExtensionDialog row={extensionRow} assignment={a} onOpenChange={(o) => !o && setExtensionRow(null)} onSaved={reload} />
      <CommentDialog row={commentRow} onOpenChange={(o) => !o && setCommentRow(null)} onSaved={reload} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this assignment?"
        description="The assignment and every file students submitted for it will be deleted permanently."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await client.delete(`/assignments/${id}`);
            toast.success("Assignment deleted");
            navigate("/assignments");
          } catch (err) {
            toast.error(apiErrorMessage(err));
          }
        }}
      />
    </div>
  );
}
