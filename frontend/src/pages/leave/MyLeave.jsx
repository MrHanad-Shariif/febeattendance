import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CalendarOff, FileText, Plus, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { useApi } from "@/components/committees/shared.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { todayIso } from "@/lib/attendance";
import { countdownText, dateRange, PHASE_VARIANTS, RequestBadge, RequestHistory } from "./shared.jsx";

const MIN_REMARKS = 10;

function emptyForm(kind = "leave") {
  const today = todayIso();
  return { kind, reason: "", custom_reason: "", start_date: today, end_date: today, remarks: "", timetable_ids: [], document: null, note: "" };
}

function RequestForm({ open, onClose, data, editing, onSaved }) {
  const [form, setForm] = useState(() =>
    editing
      ? { ...emptyForm(editing.kind), ...editing, timetable_ids: editing.timetable_ids || [], document: null, note: "" }
      : emptyForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const remarksShort = form.remarks.trim().length < MIN_REMARKS;
  const sameDay = form.kind === "same_day";

  async function submit(e) {
    e.preventDefault();
    if (remarksShort) {
      setError(`Explain the reason in the remarks (at least ${MIN_REMARKS} characters).`);
      return;
    }
    setSaving(true);
    setError("");
    const body = new FormData();
    for (const k of ["kind", "reason", "custom_reason", "remarks", "note"]) body.append(k, form[k] || "");
    body.append("start_date", sameDay ? todayIso() : form.start_date);
    body.append("end_date", sameDay ? todayIso() : form.end_date);
    form.timetable_ids.forEach((id) => body.append("timetable_ids", id));
    if (form.document) body.append("document", form.document);
    try {
      if (editing) await client.put(`/lecturer/leave-requests/${editing.id}`, body);
      else await client.post("/lecturer/leave-requests", body);
      toast.success(editing ? "Request sent again" : "Request sent to the Academic Office");
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const toggleClass = (id, on) => set({ timetable_ids: on ? [...form.timetable_ids, id] : form.timetable_ids.filter((x) => x !== id) });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Change and send again" : "Request leave or report an absence"}</DialogTitle>
            <DialogDescription>
              The Academic Office reviews every request. Your classes are only cancelled, and your students told, once it is approved.
            </DialogDescription>
          </DialogHeader>
          {editing?.review_comment && editing.status === "more_info" && (
            <Alert variant="success">Requested by the Academic Office: {editing.review_comment}</Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>What is it?</Label>
              <Select value={form.kind} onValueChange={(v) => set({ kind: v })} disabled={!!editing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leave">Leave request (planned)</SelectItem>
                  <SelectItem value="same_day">Same-day absence (today, unexpected)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type of absence / leave</Label>
              <Select value={form.reason || undefined} onValueChange={(v) => set({ reason: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose..." />
                </SelectTrigger>
                <SelectContent>
                  {data.reasons.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.reason === "other" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Describe the type</Label>
                <Input value={form.custom_reason} onChange={(e) => set({ custom_reason: e.target.value })} required />
              </div>
            )}
            {!sameDay && (
              <>
                <div className="space-y-1.5">
                  <Label>First day</Label>
                  <Input type="date" min={editing ? undefined : todayIso()} value={form.start_date} onChange={(e) => set({ start_date: e.target.value, end_date: e.target.value > form.end_date ? e.target.value : form.end_date })} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Last day</Label>
                  <Input type="date" min={form.start_date} value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} required />
                </div>
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>
              Reason / remarks <span className="text-danger">*</span>
            </Label>
            <Textarea
              rows={3}
              value={form.remarks}
              onChange={(e) => set({ remarks: e.target.value })}
              placeholder="Why you will be absent, and anything the Academic Office should know (cover, make-up plans...)"
              required
            />
            <p className={`text-xs ${remarksShort && form.remarks ? "text-danger" : "text-muted-foreground"}`}>
              Required. At least {MIN_REMARKS} characters.
            </p>
          </div>
          {data.classes.length > 0 && (
            <div className="space-y-1.5">
              <Label>Affected classes (leave all unticked for every class in these dates)</Label>
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {data.classes.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 text-sm">
                    <Checkbox checked={form.timetable_ids.includes(c.id)} onCheckedChange={(v) => toggleClass(c.id, v === true)} />
                    <span>
                      {c.course_name} <span className="text-muted-foreground">({c.batch}) · {c.days.join(", ")} {c.start_time}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Supporting document (optional: PDF, Word or photo)</Label>
            <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => set({ document: e.target.files?.[0] || null })} />
            {editing?.document_name && !form.document && <p className="text-xs text-muted-foreground">Attached: {editing.document_name}</p>}
          </div>
          {editing && (
            <div className="space-y-1.5">
              <Label>Note to the Academic Office (optional)</Label>
              <Input value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </div>
          )}
          {error && <Alert>{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form.reason}>
              <Send /> {saving ? "Sending..." : "Send to Academic Office"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusCard({ absence, title }) {
  const c = absence.countdown;
  return (
    <Card className={c.phase === "active" ? "border-warning/60 bg-warning/5" : "border-info/50 bg-info/5"}>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="text-lg font-semibold">
            {absence.reason_label} · {dateRange(absence.start_date, absence.actual_end_date || absence.end_date)}
          </p>
          <p className="text-sm text-muted-foreground">
            {absence.justified ? "Justified" : "Unjustified"} · your classes in these dates are cancelled and the students have been told.
            {c.return_date && ` Expected back ${new Date(`${c.return_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}.`}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-3xl font-bold tabular-nums">{c.phase === "active" ? (c.ongoing ? "—" : c.days_remaining) : c.starts_in_days}</p>
          <p className="text-sm text-muted-foreground">{countdownText(c)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyLeave() {
  const { data, loading, error, reload } = useApi("/lecturer/leave", null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null);

  async function withdraw(r) {
    try {
      await client.post(`/lecturer/leave-requests/${r.id}/withdraw`, {});
      toast.success("Request withdrawn");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function openDocument(r) {
    try {
      const res = await client.get(`/leave-requests/${r.id}/document`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank", "noopener");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const history = useMemo(() => (data?.absences || []).filter((a) => a.countdown.phase !== "active" && a.countdown.phase !== "upcoming"), [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My leave & absences"
        description="Request leave or report an absence, follow its review, and see how many days of leave remain."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            disabled={!data}
          >
            <Plus /> New request
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {loading && !data && <Skeleton className="h-28 w-full" />}
      {data && (
        <>
          {data.current && <StatusCard absence={data.current} title="On leave now" />}
          {data.upcoming.map((a) => (
            <StatusCard key={a.id} absence={a} title="Upcoming leave" />
          ))}
          {!data.current && data.upcoming.length === 0 && (
            <Card>
              <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
                <CalendarClock className="h-5 w-5" /> You have no current or upcoming leave recorded.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">My requests</CardTitle>
              <CardDescription>
                Pending requests are not approved leave: your classes run as normal until the Academic Office approves.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.requests.length === 0 && <p className="py-4 text-sm text-muted-foreground">No requests yet.</p>}
              {data.requests.map((r) => (
                <div key={r.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">
                        {r.reason_label} · {dateRange(r.start_date, r.end_date)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {r.kind_label} · {r.days} day{r.days === 1 ? "" : "s"}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">{r.remarks}</p>
                      {r.review_comment && (
                        <p className="text-sm">
                          <span className="font-medium">{r.reviewer_name}:</span> {r.review_comment}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RequestBadge row={r} />
                      {r.document_name && (
                        <Button size="sm" variant="ghost" onClick={() => openDocument(r)}>
                          <FileText /> Document
                        </Button>
                      )}
                      {["pending", "more_info"].includes(r.status) && (
                        <>
                          <Button
                            size="sm"
                            variant={r.status === "more_info" ? "default" : "outline"}
                            onClick={() => {
                              setEditing(r);
                              setFormOpen(true);
                            }}
                          >
                            {r.status === "more_info" ? "Add information" : "Change"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => withdraw(r)}>
                            <Undo2 /> Withdraw
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? "Hide history" : "History"}
                      </Button>
                    </div>
                  </div>
                  {expanded === r.id && (
                    <div className="mt-3">
                      <RequestHistory events={r.events} />
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarOff className="h-4 w-4 text-primary" /> Past and cancelled leave
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nothing yet.</p>}
              {history.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
                  <span>
                    {a.reason_label} · {dateRange(a.start_date, a.actual_end_date || a.end_date)}
                  </span>
                  <Badge variant={PHASE_VARIANTS[a.countdown.phase]}>{a.countdown.phase_label}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
      {formOpen && data && (
        <RequestForm
          open={formOpen}
          data={data}
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Small dashboard banner: current/upcoming leave and open requests. */
export function LeaveBanner() {
  const { data } = useApi("/lecturer/leave", null);
  if (!data) return null;
  const a = data.current || data.upcoming[0];
  if (!a && !data.pending_requests) return null;
  return (
    <Card className={a?.countdown.phase === "active" ? "border-warning/60 bg-warning/5" : "border-info/50 bg-info/5"}>
      <CardContent className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          {a ? (
            <>
              <strong>{a.countdown.phase === "active" ? "On leave" : "Upcoming leave"}:</strong> {a.reason_label},{" "}
              {dateRange(a.start_date, a.actual_end_date || a.end_date)} · {countdownText(a.countdown)}
            </>
          ) : null}
          {data.pending_requests > 0 && (
            <span className={a ? "ml-2 text-muted-foreground" : ""}>
              {data.pending_requests} leave request{data.pending_requests === 1 ? "" : "s"} waiting for review.
            </span>
          )}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/my-leave">Open my leave</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
