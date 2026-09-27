import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, Lock, MessageSquare, NotebookPen, Timer, Trash2, Upload, User } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/committees";
import { DeadlineBadge, FileRow, formatBytes } from "./shared";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function StudentAssignmentList() {
  const { data, loading, error } = useApi("/assignments", []);
  const open = (data || []).filter((a) => a.open);
  const closed = (data || []).filter((a) => !a.open);

  const renderCard = (a, i) => (
    <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
      <Link to={`/assignments/${a.id}`} className="block h-full">
        <Card className="flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{a.title}</p>
              <p className="text-xs text-muted-foreground">
                {a.course_name} · {a.lecturer_name}
              </p>
            </div>
            <DeadlineBadge iso={a.my_deadline} />
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Due {formatDateTime(a.my_deadline)}
            {a.my_extension && (
              <Badge variant="info" className="gap-1">
                <Timer className="h-3 w-3" /> Extra time
              </Badge>
            )}
            <span className="ml-auto">
              {a.submitted ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Submitted
                </Badge>
              ) : a.open ? (
                <Badge variant="warning">Not submitted</Badge>
              ) : (
                <Badge variant="danger">Missed</Badge>
              )}
            </span>
            {a.submission?.lecturer_comment && (
              <Badge variant="purple" className="gap-1">
                <MessageSquare className="h-3 w-3" /> Comment
              </Badge>
            )}
          </div>
        </Card>
      </Link>
    </motion.div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Assignments" description="Work set by your lecturers. Submissions close automatically at the deadline." />
      {error && <Alert>{error}</Alert>}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (data || []).length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <NotebookPen className="h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No assignments yet.</p>
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Open ({open.length})</h2>
            {open.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{open.map(renderCard)}</div> : <p className="text-sm text-muted-foreground">Nothing due right now.</p>}
          </section>
          {closed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Closed ({closed.length})</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{closed.map(renderCard)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function StudentAssignmentDetail() {
  const { id } = useParams();
  const { data: a, setData, error } = useApi(`/assignments/${id}`);
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  if (error) return <Alert>{error}</Alert>;
  if (!a) return <Skeleton className="h-64 w-full" />;

  const submission = a.submission;
  const noteValue = note ?? submission?.note ?? "";

  function pick(e) {
    const chosen = Array.from(e.target.files || []);
    const tooBig = chosen.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      toast.error(`${tooBig.name} is larger than 15 MB`);
      e.target.value = "";
      return;
    }
    setFiles(chosen);
  }

  async function submit(e) {
    e.preventDefault();
    if (!files.length && !submission?.files.length) return toast.error("Choose at least one file");
    setBusy(true);
    try {
      // One file per request keeps each upload within the size limit.
      let latest = null;
      const queue = files.length ? files : [null];
      for (let i = 0; i < queue.length; i++) {
        const fd = new FormData();
        if (queue[i]) fd.append("files", queue[i]);
        if (i === 0) fd.append("note", noteValue);
        latest = (await client.post(`/assignments/${id}/submission`, fd)).data;
      }
      setData(latest);
      setFiles([]);
      setNote(null);
      if (inputRef.current) inputRef.current.value = "";
      toast.success("Submitted. You can add or remove files until the deadline.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(file) {
    setBusy(true);
    try {
      const res = await client.delete(`/assignments/${id}/submission/files/${file.id}`);
      setData(res.data);
      toast.success("File removed");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.title}
        description={`${a.course_name} · ${a.batch}`}
        actions={<DeadlineBadge iso={a.my_deadline} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Instructions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {a.instructions ? <p className="whitespace-pre-wrap text-sm">{a.instructions}</p> : <p className="text-sm text-muted-foreground">No written instructions.</p>}
              {a.file_url && <FileRow file={{ file_name: a.file_name, url: a.file_url }} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your submission</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {submission?.files.length ? (
                <div className="space-y-2">
                  {submission.files.map((f) => (
                    <FileRow
                      key={f.id}
                      file={f}
                      action={
                        a.open && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Remove ${f.file_name}`} disabled={busy} onClick={() => removeFile(f)}>
                            <Trash2 />
                          </Button>
                        )
                      }
                    />
                  ))}
                  <p className="text-xs text-muted-foreground">Last updated {formatDateTime(submission.updated_at)}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing submitted yet.</p>
              )}

              {a.open ? (
                <form onSubmit={submit} className="space-y-4 border-t pt-4">
                  <Field label="Attach files" htmlFor="sub-files" hint="Any file type, up to 15 MB each and 10 files in total.">
                    <Input
                      ref={inputRef}
                      id="sub-files"
                      type="file"
                      multiple
                      onChange={pick}
                      className="cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
                    />
                  </Field>
                  {files.length > 0 && (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {files.map((f) => (
                        <li key={f.name}>
                          {f.name} · {formatBytes(f.size)}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Field label="Note to your lecturer (optional)" htmlFor="sub-note">
                    <Textarea id="sub-note" rows={3} maxLength={5000} value={noteValue} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <Button type="submit" disabled={busy}>
                    <Upload /> {busy ? "Uploading..." : submission?.files.length ? "Update submission" : "Submit"}
                  </Button>
                </form>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <p>The deadline has passed, so this assignment is closed and no more files can be submitted.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Deadline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-lg font-semibold">{formatDateTime(a.my_deadline)}</p>
              {a.my_extension && (
                <p className="flex items-center gap-1.5 text-info">
                  <Timer className="h-4 w-4" /> Your lecturer gave you extra time (class deadline {formatDateTime(a.deadline)}).
                </p>
              )}
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <User className="h-4 w-4" /> {a.lecturer_name}
              </p>
            </CardContent>
          </Card>
          <Card className={submission?.lecturer_comment ? "border-purple-500/40" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-4 w-4" /> Lecturer's comment
              </CardTitle>
            </CardHeader>
            <CardContent>
              {submission?.lecturer_comment ? (
                <>
                  <p className="whitespace-pre-wrap text-sm">{submission.lecturer_comment}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(submission.commented_at)}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No comment yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
