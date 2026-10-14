import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Eye, History, MonitorSmartphone, Plus, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext.jsx";
import { todayIso } from "@/lib/attendance";

const STATUS_VARIANTS = { scheduled: "info", active: "warning", completed: "secondary", cancelled: "secondary" };
const SCOPES = [
  ["session", "One session (one class, one day)"],
  ["classes", "Selected classes"],
  ["batch", "A whole class (batch)"],
  ["course", "A course"],
  ["lecturer", "All of a lecturer's classes"],
];
const ACTIONS = { created: "Created", changed: "Changed", extended: "Extended", ended_early: "Ended early", cancelled: "Cancelled" };

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

function F({ label, children, className = "" }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function scopeText(a) {
  const parts = [];
  if (a.lecturer_name) parts.push(`Lecturer: ${a.lecturer_name}`);
  if (a.batches.length) parts.push(`Class: ${a.batches.join(", ")}`);
  if (a.courses.length) parts.push(`Course: ${a.courses.join(", ")}`);
  if (a.timetable_ids.length) parts.push(`${a.timetable_ids.length} selected class(es)`);
  if (a.days.length) parts.push(a.days.join(", "));
  return parts.join(" · ");
}

function CreateDialog({ open, onClose, options, onSaved }) {
  const [scope, setScope] = useState("batch");
  const [form, setForm] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (open) {
      setScope("batch");
      setForm({ start_date: todayIso(), end_date: addDays(todayIso(), 6), timetable_ids: [] });
      setPreview(null);
      setError("");
    }
  }, [open]);

  const body = useMemo(() => {
    const b = { title: form.title, start_date: form.start_date, end_date: scope === "session" ? form.start_date : form.end_date,
      meeting_link: form.meeting_link, instructions: form.instructions, reason: form.reason };
    if (scope === "session" || scope === "classes") b.timetable_ids = form.timetable_ids;
    if (scope === "batch" && form.batch) b.batches = [form.batch];
    if (scope === "course" && form.course) b.courses = [form.course];
    if (scope === "lecturer" && form.lecturer_id) b.lecturer_id = Number(form.lecturer_id);
    return b;
  }, [form, scope]);

  const chosen = Boolean(body.timetable_ids?.length || body.batches || body.courses || body.lecturer_id);

  useEffect(() => {
    if (!open) return undefined;
    if (!chosen) {
      setPreview(null);
      setError("");
      return undefined;
    }
    const t = setTimeout(() => {
      client
        .post("/admin/online/preview", body)
        .then((r) => {
          setPreview(r.data);
          setError("");
        })
        .catch((err) => {
          setPreview(null);
          setError(apiErrorMessage(err));
        });
    }, 300);
    return () => clearTimeout(t);
  }, [body, open, chosen]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await client.post("/admin/online", body);
      toast.success("Online teaching set up. The lecturers and students have been told.");
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const toggleClass = (id, on) =>
    set({ timetable_ids: scope === "session" ? (on ? [id] : []) : on ? [...form.timetable_ids, id] : form.timetable_ids.filter((x) => x !== id) });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MonitorSmartphone className="h-5 w-5 text-primary" /> Move teaching online
            </DialogTitle>
            <DialogDescription>
              For the chosen dates the sessions are taught online: lecturers and students check in through FEBEMS without the campus code or
              location (faces are still checked). After the last day the classes are back on campus automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="What moves online" className="sm:col-span-2">
              <Select value={scope} onValueChange={(v) => { setScope(v); set({ timetable_ids: [] }); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
            {scope === "batch" && (
              <F label="Class (batch)">
                <Select value={form.batch || undefined} onValueChange={(v) => set({ batch: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.batches.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </F>
            )}
            {scope === "course" && (
              <F label="Course">
                <Select value={form.course || undefined} onValueChange={(v) => set({ course: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.courses.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </F>
            )}
            {scope === "lecturer" && (
              <F label="Lecturer">
                <Select value={form.lecturer_id || undefined} onValueChange={(v) => set({ lecturer_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.lecturers.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </F>
            )}
            {(scope === "session" || scope === "classes") && (
              <F label={scope === "session" ? "The class" : "Classes"} className="sm:col-span-2">
                <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                  {options.classes.map((c) => (
                    <label key={c.id} className="flex items-start gap-2 text-sm">
                      <Checkbox checked={form.timetable_ids.includes(c.id)} onCheckedChange={(v) => toggleClass(c.id, v === true)} />
                      <span>
                        {c.course_name} <span className="text-muted-foreground">({c.batch}) · {c.days.join(", ")} {c.start_time} · {c.lecturer_name || "no lecturer"}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </F>
            )}
            <F label={scope === "session" ? "Date" : "First online day"}>
              <Input type="date" min={todayIso()} value={form.start_date || ""} onChange={(e) => set({ start_date: e.target.value })} required />
            </F>
            {scope !== "session" && (
              <F label="Last online day">
                <Input type="date" min={form.start_date} value={form.end_date || ""} onChange={(e) => set({ end_date: e.target.value })} required />
                <div className="flex gap-1 pt-1">
                  {[
                    ["1 week", 6],
                    ["2 weeks", 13],
                  ].map(([l, n]) => (
                    <Button key={l} type="button" size="sm" variant="outline" onClick={() => set({ end_date: addDays(form.start_date || todayIso(), n) })}>
                      {l}
                    </Button>
                  ))}
                </div>
              </F>
            )}
            <F label="Online class link (optional)" className="sm:col-span-2">
              <Input type="url" placeholder="https://meet.google.com/..." value={form.meeting_link || ""} onChange={(e) => set({ meeting_link: e.target.value })} />
            </F>
            <F label="Instructions for students (optional)" className="sm:col-span-2">
              <Textarea rows={2} value={form.instructions || ""} onChange={(e) => set({ instructions: e.target.value })} />
            </F>
            <F label="Title (optional)">
              <Input value={form.title || ""} placeholder="e.g. Exam week online" onChange={(e) => set({ title: e.target.value })} />
            </F>
            <F label="Reason (optional)">
              <Input value={form.reason || ""} onChange={(e) => set({ reason: e.target.value })} />
            </F>
          </div>
          {preview && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{preview.total_sessions} session(s) will be online</p>
              <p className="text-muted-foreground">{preview.classes.map((c) => `${c.course_name} (${c.batch}) ×${c.sessions}`).join(", ") || "No timetabled sessions in these dates."}</p>
              {preview.conflicts.length > 0 && <p className="text-danger">Some of these sessions are already online under another arrangement.</p>}
            </div>
          )}
          {error && <Alert>{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !preview || !preview.total_sessions || preview.conflicts.length > 0}>
              {saving ? "Saving..." : "Move online"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const [a, setA] = useState(null);
  const [end, setEnd] = useState("");
  const [back, setBack] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    client.get(`/admin/online/${id}`).then((r) => {
      setA(r.data);
      setEnd(r.data.actual_end_date || r.data.end_date);
    });
  }
  useEffect(() => {
    if (id) {
      setA(null);
      load();
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn, msg) {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      load();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const live = a && a.status !== "cancelled" && a.status !== "completed";
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{a ? a.title || "Online teaching" : "Loading..."}</DialogTitle>
          {a && (
            <DialogDescription className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANTS[a.status]}>{a.status_label}</Badge> {fmt(a.start_date)} – {fmt(a.actual_end_date || a.end_date)} · back on campus{" "}
              {fmt(a.return_date)}
            </DialogDescription>
          )}
        </DialogHeader>
        {a && (
          <div className="space-y-4 text-sm">
            <p>{scopeText(a)}</p>
            <p className="text-muted-foreground">
              {a.affected.total_sessions} session(s): {a.affected.classes.map((c) => `${c.course_name} (${c.batch}) ×${c.sessions}`).join(", ")}
            </p>
            {a.meeting_link && (
              <p>
                Link:{" "}
                <a className="text-primary underline" href={a.meeting_link} target="_blank" rel="noopener noreferrer">
                  {a.meeting_link}
                </a>
              </p>
            )}
            {a.instructions && <p>Instructions: {a.instructions}</p>}
            {live && can("online_teaching:edit") && (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <F label="Change the last online day (extend or shorten)">
                  <div className="flex gap-2">
                    <Input type="date" min={todayIso()} value={end} onChange={(e) => setEnd(e.target.value)} />
                    <Button size="sm" onClick={() => run(() => client.put(`/admin/online/${a.id}`, { end_date: end }), "Online period changed; everyone has been told")} disabled={busy}>
                      <CalendarCheck /> Save
                    </Button>
                  </div>
                </F>
                {a.status === "active" && (
                  <F label="End early: back on campus from">
                    <div className="flex gap-2">
                      <Input type="date" min={todayIso()} value={back} onChange={(e) => setBack(e.target.value)} />
                      <Button size="sm" variant="outline" onClick={() => run(() => client.post(`/admin/online/${a.id}/end`, { return_date: back }), "Back on campus; everyone has been told")} disabled={busy}>
                        <Undo2 /> End early
                      </Button>
                    </div>
                  </F>
                )}
              </div>
            )}
            {a.status === "scheduled" && can("online_teaching:delete") && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                <F label="Cancel (classes stay on campus)" className="min-w-[220px] flex-1">
                  <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                </F>
                <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(() => client.post(`/admin/online/${a.id}/cancel`, { reason }), "Cancelled; everyone has been told")}>
                  <X /> Cancel it
                </Button>
              </div>
            )}
            <div>
              <p className="mb-2 flex items-center gap-2 font-medium">
                <History className="h-4 w-4" /> History
              </p>
              <ol className="space-y-1 border-l pl-4">
                {a.events.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{ACTIONS[e.action] || e.action}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {e.actor_name} · {new Date(e.created_at).toLocaleString()}
                    </span>
                    {e.note && <p className="text-muted-foreground">{e.note}</p>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function OnlineTeaching() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState({ lecturers: [], classes: [], batches: [], courses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  function load() {
    setLoading(true);
    client
      .get("/admin/online")
      .then((r) => setRows(r.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    client.get("/admin/online/options").then((r) => setOptions(r.data)).catch(() => {});
  }, []);

  const columns = useMemo(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Online teaching" />,
        meta: { label: "Title" },
        cell: ({ row }) => (
          <button type="button" className="text-left" onClick={() => setViewing(row.original.id)}>
            <p className="font-medium hover:text-primary hover:underline">{row.original.title || "Online teaching"}</p>
            <p className="text-xs text-muted-foreground">{scopeText(row.original)}</p>
          </button>
        ),
      },
      { id: "dates", accessorFn: (r) => r.start_date, header: ({ column }) => <DataTableColumnHeader column={column} title="Dates" />, meta: { label: "Dates" }, cell: ({ row }) => `${fmt(row.original.start_date)} – ${fmt(row.original.actual_end_date || row.original.end_date)}` },
      { accessorKey: "return_date", header: "Back on campus", meta: { label: "Back on campus" }, cell: ({ getValue }) => fmt(getValue()) },
      { accessorKey: "sessions", header: "Sessions", meta: { label: "Sessions" } },
      { accessorKey: "status", header: "Status", meta: { label: "Status", exportValue: (r) => r.status_label }, cell: ({ row }) => <Badge variant={STATUS_VARIANTS[row.original.status]}>{row.original.status_label}</Badge> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { noExport: true, className: "text-right" },
        cell: ({ row }) => (
          <Button size="sm" variant="ghost" onClick={() => setViewing(row.original.id)}>
            <Eye /> Details
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Online teaching"
        description="Move a session, classes, a course or a lecturer online for a set period. Afterwards the classes return to campus by themselves."
        actions={
          can("online_teaching:add") && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Move online
            </Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      <DataTable columns={columns} data={rows} loading={loading} getRowId={(r) => String(r.id)} exportName="online-teaching" emptyText="No online teaching arranged." />
      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        options={options}
        onSaved={() => {
          setCreating(false);
          load();
        }}
      />
      <DetailDialog id={viewing} onClose={() => setViewing(null)} onChanged={load} />
    </div>
  );
}
