import { useEffect, useMemo, useState } from "react";
import { Ban, CalendarCheck, CalendarOff, Eye, MoreHorizontal, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext.jsx";
import { ABSENCE_STATUS, WEEKDAYS, formatDate, todayIso } from "@/lib/attendance";

const ALL = "all";

function StatusPill({ status, label }) {
  return <Badge variant={ABSENCE_STATUS[status]?.variant || "muted"}>{label || ABSENCE_STATUS[status]?.label}</Badge>;
}

function endLabel(a) {
  if (a.actual_end_date) return `${formatDate(a.actual_end_date)} (returned early)`;
  if (a.end_date) return formatDate(a.end_date);
  return "Ongoing (no end date)";
}

/** Toggle chips for a multi-select list (classes, subjects, days). */
function ChipPicker({ options, value, onChange, empty }) {
  if (!options.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  const set = new Set(value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = set.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const EMPTY_FORM = {
  lecturer_id: "",
  start_date: todayIso(),
  end_date: "",
  ongoing: false,
  reason: "medical_leave",
  custom_reason: "",
  remarks: "",
  justified: true,
  batches: [],
  courses: [],
  days: [],
  timetable_ids: [],
};

function AbsenceForm({ open, onOpenChange, editing, options, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [classes, setClasses] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewKey, setPreviewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changeNote, setChangeNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setPreview(null);
    setPreviewKey("");
    setChangeNote("");
    if (editing) {
      setForm({
        lecturer_id: String(editing.lecturer_id),
        start_date: editing.start_date,
        end_date: editing.end_date || "",
        ongoing: !editing.end_date,
        reason: editing.reason,
        custom_reason: editing.custom_reason || "",
        remarks: editing.remarks || "",
        justified: editing.justified,
        batches: editing.batches || [],
        courses: editing.courses || [],
        days: editing.days || [],
        timetable_ids: editing.timetable_ids || [],
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editing]);

  useEffect(() => {
    if (!form.lecturer_id) {
      setClasses([]);
      return;
    }
    client
      .get(`/admin/lecturer-absences/lecturer/${form.lecturer_id}/classes`)
      .then((res) => setClasses(res.data))
      .catch(() => setClasses([]));
  }, [form.lecturer_id]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function body() {
    return {
      ...(editing ? { id: editing.id } : {}),
      lecturer_id: form.lecturer_id ? Number(form.lecturer_id) : null,
      start_date: form.start_date,
      end_date: form.ongoing ? null : form.end_date || null,
      ongoing: form.ongoing,
      reason: form.reason,
      custom_reason: form.reason === "other" ? form.custom_reason : null,
      remarks: form.remarks,
      justified: form.justified,
      batches: form.batches,
      courses: form.courses,
      days: form.days,
      timetable_ids: form.timetable_ids,
    };
  }
  const currentKey = JSON.stringify(body());
  const previewFresh = preview && previewKey === currentKey;

  async function runPreview() {
    setBusy(true);
    setError("");
    try {
      const res = await client.post("/admin/lecturer-absences/preview", body());
      setPreview(res.data);
      setPreviewKey(currentKey);
    } catch (err) {
      setError(apiErrorMessage(err));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload = body();
      delete payload.id;
      const res = editing
        ? await client.put(`/admin/lecturer-absences/${editing.id}`, { ...payload, change_note: changeNote })
        : await client.post("/admin/lecturer-absences", payload);
      const flagged = res.data.flagged_for_review || 0;
      toast.success(
        `${editing ? "Absence updated" : "Absence recorded"}.` +
          (flagged ? ` ${flagged} existing attendance record(s) were flagged for review.` : "")
      );
      onSaved(res.data);
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const batchOptions = [...new Set(classes.map((c) => c.batch).filter(Boolean))].sort().map((b) => ({ value: b, label: b }));
  const courseOptions = [...new Set(classes.map((c) => c.course_name))].sort().map((c) => ({ value: c, label: c }));
  const sessionOptions = classes.map((c) => ({
    value: c.id,
    label: `${c.batch || "—"} · ${c.course_name} · ${c.days.join("/")} ${c.start_time}${c.end_time ? `–${c.end_time}` : ""}`,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarOff className="h-5 w-5 text-primary" /> {editing ? "Edit absence" : "Record lecturer absence"}
          </DialogTitle>
          <DialogDescription>
            The affected teaching sessions are found from the timetable. Students are not marked absent for them, and they
            don't count in anyone's attendance percentage. Attendance already recorded is kept and listed for review.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Lecturer</Label>
            <Select value={form.lecturer_id} onValueChange={(v) => set({ lecturer_id: v, batches: [], courses: [], timetable_ids: [] })} disabled={!!editing}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a lecturer" />
              </SelectTrigger>
              <SelectContent>
                {options.lecturers.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                    {l.status !== "active" ? ` (${l.status})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="abs-start">Start date</Label>
            <Input id="abs-start" type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="abs-end">Expected end date</Label>
            <Input
              id="abs-end"
              type="date"
              value={form.ongoing ? "" : form.end_date}
              min={form.start_date}
              disabled={form.ongoing}
              onChange={(e) => set({ end_date: e.target.value })}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={form.ongoing} onCheckedChange={(v) => set({ ongoing: !!v })} /> Ongoing: return date not known yet
            </label>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={form.reason} onValueChange={(v) => set({ reason: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.reasons.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.value === "other" ? "Other (describe)" : r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.reason === "other" ? (
            <div className="space-y-1.5">
              <Label htmlFor="abs-custom">Describe the reason</Label>
              <Input id="abs-custom" value={form.custom_reason} maxLength={200} onChange={(e) => set({ custom_reason: e.target.value })} />
            </div>
          ) : (
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.justified} onCheckedChange={(v) => set({ justified: !!v })} /> Justified (approved or documented)
              </label>
            </div>
          )}
          {form.reason === "other" && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={form.justified} onCheckedChange={(v) => set({ justified: !!v })} /> Justified (approved or documented)
            </label>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="abs-remarks">Remarks (optional)</Label>
            <Textarea id="abs-remarks" rows={2} maxLength={1000} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </div>
        </div>

        {form.lecturer_id && (
          <Card className="bg-muted/30">
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium">
                Limit to specific classes, subjects, days or sessions <span className="font-normal text-muted-foreground">(optional; leave empty for all)</span>
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Classes</Label>
                <ChipPicker options={batchOptions} value={form.batches} onChange={(batches) => set({ batches })} empty="This lecturer has no classes on the timetable." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Subjects</Label>
                <ChipPicker options={courseOptions} value={form.courses} onChange={(courses) => set({ courses })} empty="—" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Days</Label>
                <ChipPicker options={WEEKDAYS.map((d) => ({ value: d, label: d }))} value={form.days} onChange={(days) => set({ days })} />
              </div>
              {sessionOptions.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Sessions (timetable rows)</Label>
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
                    {sessionOptions.map((o) => (
                      <label key={o.value} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={form.timetable_ids.includes(o.value)}
                          onCheckedChange={(v) =>
                            set({ timetable_ids: v ? [...form.timetable_ids, o.value] : form.timetable_ids.filter((x) => x !== o.value) })
                          }
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {preview && (
          <div className={`space-y-2 rounded-lg border p-3 text-sm ${previewFresh ? "" : "opacity-50"}`}>
            <p className="font-medium">
              {preview.total_sessions} affected session{preview.total_sessions === 1 ? "" : "s"}
              {preview.ongoing && preview.projected_until ? ` (projected to ${formatDate(preview.projected_until)}, while ongoing)` : ""}
              {preview.past_sessions ? `, ${preview.past_sessions} already in the past` : ""}
            </p>
            {preview.classes.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-2">Class</th>
                      <th className="py-1 pr-2">Subject</th>
                      <th className="py-1 pr-2 text-right">Sessions</th>
                      <th className="py-1 text-right">Past</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.classes.map((c) => (
                      <tr key={`${c.batch}-${c.course_name}`} className="border-t">
                        <td className="py-1 pr-2">{c.batch}</td>
                        <td className="py-1 pr-2">{c.course_name}</td>
                        <td className="py-1 pr-2 text-right">{c.sessions}</td>
                        <td className="py-1 text-right">{c.past_sessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground">No teaching sessions fall in this period with these choices.</p>
            )}
            {(preview.existing_student_records > 0 || preview.existing_lecturer_records > 0) && (
              <p className="text-warning">
                {preview.existing_student_records} student and {preview.existing_lecturer_records} lecturer attendance record(s) already exist for
                these sessions. They will be kept unchanged and flagged for review.
              </p>
            )}
            {preview.conflicts.length > 0 && (
              <Alert>
                Conflicts with an existing absence:{" "}
                {preview.conflicts.map((c) => `${c.reason_label} ${formatDate(c.start_date)} – ${c.end_date ? formatDate(c.end_date) : "ongoing"}`).join("; ")}
              </Alert>
            )}
          </div>
        )}

        {editing && (
          <div className="space-y-1.5">
            <Label htmlFor="abs-note">Reason for this change (kept in the audit trail)</Label>
            <Input id="abs-note" value={changeNote} maxLength={500} onChange={(e) => setChangeNote(e.target.value)} />
          </div>
        )}

        {error && <Alert>{error}</Alert>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" variant="secondary" onClick={runPreview} disabled={busy || !form.lecturer_id}>
            <RefreshCw /> {previewFresh ? "Refresh preview" : "Preview affected sessions"}
          </Button>
          <Button type="button" onClick={save} disabled={busy || !previewFresh || preview?.conflicts.length > 0}>
            {busy ? "Saving..." : editing ? "Save changes" : "Record absence"}
          </Button>
        </DialogFooter>
        {!previewFresh && <p className="-mt-2 text-right text-xs text-muted-foreground">Preview the affected sessions before saving.</p>}
      </DialogContent>
    </Dialog>
  );
}

function AbsenceDetail({ id, onOpenChange, onChanged, canEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);

  function load() {
    if (!id) return;
    client
      .get(`/admin/lecturer-absences/${id}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(apiErrorMessage(err)));
  }
  useEffect(() => {
    setData(null);
    setSelected([]);
    load();
  }, [id]);

  async function resolve(resolution, all = false) {
    try {
      const res = await client.post(`/admin/lecturer-absences/${id}/review`, all ? { all: true, resolution } : { item_ids: selected, resolution });
      setData(res.data);
      setSelected([]);
      onChanged();
      toast.success("Review saved");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const pending = data?.review_items.filter((i) => i.resolution === "pending").length || 0;

  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data ? `${data.lecturer_name}: ${data.reason_label}` : "Absence"}</DialogTitle>
          {data && (
            <DialogDescription>
              {formatDate(data.start_date)} – {endLabel(data)} · <StatusPill status={data.status} label={data.status_label} /> ·{" "}
              {data.justified ? "Justified" : "Unjustified"}
            </DialogDescription>
          )}
        </DialogHeader>
        {error && <Alert>{error}</Alert>}
        {!data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Remarks:</span> {data.remarks || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Recorded by:</span> {data.created_by_name || "—"} on {data.created_at?.slice(0, 10)}
              </p>
              <p>
                <span className="text-muted-foreground">Scope:</span>{" "}
                {[data.batches.join(", "), data.courses.join(", "), data.days.join(", "), data.timetable_ids.length ? `${data.timetable_ids.length} session(s)` : ""]
                  .filter(Boolean)
                  .join(" · ") || "All of the lecturer's classes"}
              </p>
              {data.status === "cancelled" && (
                <p>
                  <span className="text-muted-foreground">Cancelled:</span> {data.cancel_reason} ({data.cancelled_by_name})
                </p>
              )}
            </div>

            <section>
              <h3 className="mb-2 font-semibold">
                Affected classes ({data.affected.total_sessions} sessions{data.ongoing ? ", projected while ongoing" : ""})
              </h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">Class</th>
                      <th className="p-2">Subject</th>
                      <th className="p-2 text-right">Sessions</th>
                      <th className="p-2 text-right">Already past</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.affected.classes.map((c) => (
                      <tr key={`${c.batch}-${c.course_name}`} className="border-t">
                        <td className="p-2">{c.batch}</td>
                        <td className="p-2">{c.course_name}</td>
                        <td className="p-2 text-right">{c.sessions}</td>
                        <td className="p-2 text-right">{c.past_sessions}</td>
                      </tr>
                    ))}
                    {data.affected.classes.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-3 text-center text-muted-foreground">
                          No sessions covered.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {data.sessions.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-primary">Show each session</summary>
                  <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs">
                    {data.sessions.map((s) => (
                      <li key={`${s.date}-${s.timetable_id}`}>
                        {s.day} {formatDate(s.date)} · {s.start_time}–{s.end_time || "?"} · {s.batch} · {s.course_name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            <section>
              <h3 className="mb-1 font-semibold">Attendance recorded during the absence ({data.review_items.length})</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                These rows existed before the absence was recorded (or the lecturer checked in anyway). They are never changed. By
                default the session is exempted; choose "Keep as recorded" when the class actually took place.
              </p>
              {data.review_items.length > 0 && (
                <>
                  {canEdit && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={!selected.length} onClick={() => resolve("exempted")}>
                        Exempt selected
                      </Button>
                      <Button size="sm" variant="outline" disabled={!selected.length} onClick={() => resolve("kept")}>
                        Keep selected as recorded
                      </Button>
                      {pending > 0 && (
                        <Button size="sm" onClick={() => resolve("exempted", true)}>
                          Confirm exemption for all
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="max-h-64 overflow-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                        <tr>
                          {canEdit && <th className="p-2" />}
                          <th className="p-2">Date</th>
                          <th className="p-2">Who</th>
                          <th className="p-2">Session</th>
                          <th className="p-2">Recorded status</th>
                          <th className="p-2">Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.review_items.map((i) => (
                          <tr key={i.id} className="border-t">
                            {canEdit && (
                              <td className="p-2">
                                <Checkbox
                                  checked={selected.includes(i.id)}
                                  onCheckedChange={(v) => setSelected((s) => (v ? [...s, i.id] : s.filter((x) => x !== i.id)))}
                                />
                              </td>
                            )}
                            <td className="p-2">{formatDate(i.date)}</td>
                            <td className="p-2">{i.person_name}</td>
                            <td className="p-2">{[i.batch, i.course_name].filter(Boolean).join(" · ")}</td>
                            <td className="p-2 capitalize">{(i.original_status || "").replace("_", " ")}</td>
                            <td className="p-2">
                              <Badge variant={i.resolution === "kept" ? "warning" : i.resolution === "exempted" ? "success" : "muted"}>
                                {i.resolution === "pending" ? "Pending (exempted)" : i.resolution === "kept" ? "Kept as recorded" : "Exempted"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section>
              <h3 className="mb-2 font-semibold">Audit trail</h3>
              <ol className="space-y-1.5 text-xs">
                {data.events.map((e) => (
                  <li key={e.id} className="rounded-md border p-2">
                    <span className="font-medium capitalize">{e.action.replace("_", " ")}</span> by {e.actor_name} ·{" "}
                    {new Date(e.created_at).toLocaleString()}
                    {e.note && <span className="block text-muted-foreground">{e.note}</span>}
                    {e.action === "edited" && e.old_value && e.new_value && (
                      <span className="block text-muted-foreground">
                        {Object.keys(e.new_value)
                          .filter((k) => JSON.stringify(e.old_value[k]) !== JSON.stringify(e.new_value[k]))
                          .map((k) => `${k.replace("_", " ")}: ${JSON.stringify(e.old_value[k])} → ${JSON.stringify(e.new_value[k])}`)
                          .join("; ")}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function LecturerAbsences() {
  const { can } = useAuth();
  const canAdd = can("lecturer_absences:add");
  const canEdit = can("lecturer_absences:edit");
  const canCancel = can("lecturer_absences:delete");
  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState({ lecturers: [], reasons: [], statuses: [] });
  const [filters, setFilters] = useState({ lecturer_id: ALL, reason: ALL, status: ALL, from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [closing, setClosing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [dialogInput, setDialogInput] = useState({ date: todayIso(), text: "" });

  useEffect(() => {
    client.get("/admin/lecturer-absences/options").then((res) => setOptions(res.data)).catch(() => {});
  }, []);

  function load() {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v && v !== ALL));
    client
      .get("/admin/lecturer-absences", { params })
      .then((res) => setRows(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [filters]);

  async function submitClose() {
    try {
      await client.post(`/admin/lecturer-absences/${closing.id}/close`, { return_date: dialogInput.date, note: dialogInput.text });
      toast.success("Absence closed. Normal attendance applies from the return date.");
      setClosing(null);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function submitCancel() {
    try {
      await client.post(`/admin/lecturer-absences/${cancelling.id}/cancel`, { reason: dialogInput.text });
      toast.success("Absence cancelled. Its sessions are no longer exempted.");
      setCancelling(null);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: "lecturer_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lecturer" />,
        meta: { label: "Lecturer" },
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      },
      {
        accessorKey: "start_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Start" />,
        meta: { label: "Start" },
        cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDate(getValue())}</span>,
      },
      {
        id: "end",
        accessorFn: (r) => r.actual_end_date || r.end_date || "",
        header: "End",
        meta: { label: "End", exportValue: (r) => endLabel(r) },
        cell: ({ row }) => <span className="whitespace-nowrap text-sm">{endLabel(row.original)}</span>,
      },
      {
        accessorKey: "reason_label",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reason" />,
        meta: { label: "Reason" },
        cell: ({ row }) => (
          <span>
            {row.original.reason_label}
            {!row.original.justified && <span className="ml-1 text-xs text-danger">(unjustified)</span>}
          </span>
        ),
      },
      {
        accessorKey: "remarks",
        header: "Remarks",
        meta: { label: "Remarks" },
        cell: ({ getValue }) => <span className="line-clamp-2 max-w-[200px] text-xs">{getValue() || "—"}</span>,
      },
      {
        id: "affected",
        accessorFn: (r) => [...r.affected_classes, ...r.affected_courses].join(", "),
        header: "Classes / subjects",
        meta: { label: "Classes / subjects" },
        cell: ({ row }) => (
          <div className="max-w-[240px] text-xs">
            <p>{row.original.affected_classes.join(", ") || "—"}</p>
            <p className="text-muted-foreground">{row.original.affected_courses.join(", ")}</p>
          </div>
        ),
      },
      {
        accessorKey: "affected_sessions",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sessions" />,
        meta: { label: "Sessions" },
        cell: ({ row }) => (
          <span>
            {row.original.affected_sessions}
            {row.original.ongoing && <span className="text-xs text-muted-foreground"> so far*</span>}
            {row.original.pending_reviews > 0 && (
              <Badge variant="warning" className="ml-1 text-[10px]">
                {row.original.pending_reviews} to review
              </Badge>
            )}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status", exportValue: (r) => r.status_label },
        cell: ({ row }) => <StatusPill status={row.original.status} label={row.original.status_label} />,
      },
      {
        accessorKey: "created_by_name",
        header: "Recorded by",
        meta: { label: "Recorded by" },
        cell: ({ getValue }) => getValue() || "—",
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Recorded" />,
        meta: { label: "Date recorded" },
        cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDate(getValue()?.slice(0, 10))}</span>,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => {
          const a = row.original;
          const open = a.status !== "cancelled";
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setViewing(a.id)}>
                  <Eye /> View
                </DropdownMenuItem>
                {canEdit && open && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(a);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {canEdit && open && a.status !== "completed" && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setDialogInput({ date: todayIso(), text: "" });
                      setClosing(a);
                    }}
                  >
                    <CalendarCheck /> Close (lecturer returned)
                  </DropdownMenuItem>
                )}
                {canCancel && open && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => {
                        setDialogInput({ date: todayIso(), text: "" });
                        setCancelling(a);
                      }}
                    >
                      <Ban /> Cancel absence
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [canEdit, canCancel]
  );

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lecturer absences & leave"
        description="Record medical leave, official duty, training and other absences. Affected class sessions are exempted from student attendance."
        actions={
          canAdd && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus /> Record absence
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Lecturer</Label>
          <Select value={filters.lecturer_id} onValueChange={(v) => setFilter({ lecturer_id: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All lecturers</SelectItem>
              {options.lecturers.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Reason</Label>
          <Select value={filters.reason} onValueChange={(v) => setFilter({ reason: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All reasons</SelectItem>
              {options.reasons.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={filters.status} onValueChange={(v) => setFilter({ status: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {options.statuses.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search lecturer, reason or class..."
        exportName="lecturer-absences"
        emptyText="No absences recorded for these filters."
        pageSize={20}
      />
      <p className="text-xs text-muted-foreground">* Ongoing absences are projected to the end of the semester.</p>

      <AbsenceForm open={formOpen} onOpenChange={setFormOpen} editing={editing} options={options} onSaved={load} />
      <AbsenceDetail id={viewing} onOpenChange={(o) => !o && setViewing(null)} onChanged={load} canEdit={canEdit} />

      <Dialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close absence: {closing?.lecturer_name}</DialogTitle>
            <DialogDescription>
              Enter the lecturer's first day back. Sessions from that day on are no longer exempted, so normal attendance resumes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="return-date">Returned on</Label>
            <Input id="return-date" type="date" value={dialogInput.date} onChange={(e) => setDialogInput((d) => ({ ...d, date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="close-note">Note (optional)</Label>
            <Input id="close-note" value={dialogInput.text} maxLength={500} onChange={(e) => setDialogInput((d) => ({ ...d, text: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>
              Back
            </Button>
            <Button onClick={submitClose}>Close absence</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel absence: {cancelling?.lecturer_name}?</DialogTitle>
            <DialogDescription>
              Use this when the absence was recorded by mistake. Its sessions stop being exempted. The record stays in the list as
              Cancelled, with its audit trail. Sessions that already passed are not marked absent retroactively.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason for cancelling</Label>
            <Input id="cancel-reason" value={dialogInput.text} maxLength={500} onChange={(e) => setDialogInput((d) => ({ ...d, text: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Back
            </Button>
            <Button variant="destructive" onClick={submitCancel} disabled={!dialogInput.text.trim()}>
              Cancel absence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
