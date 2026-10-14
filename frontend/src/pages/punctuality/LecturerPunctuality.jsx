import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import ExportMenu from "@/components/ExportMenu.jsx";
import PeriodFields, { periodParams, periodReady } from "@/components/PeriodFields.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext.jsx";
import { CATEGORIES, todayIso } from "@/lib/attendance";
import { usePeriod } from "./Punctuality.jsx";

const DECISIONS = [
  ["makeup_required", "Makeup session(s) required"],
  ["warning", "Formal warning"],
  ["no_action", "Reviewed: no action"],
  ["deferred", "Deferred"],
];
const MK_VARIANT = { assigned: "info", completed: "success", cancelled: "secondary" };

function Stat({ label, value, tone = "" }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </Card>
  );
}

export default function LecturerPunctuality() {
  const { id } = useParams();
  const { can } = useAuth();
  const canEdit = can("lecturer_attendance:edit");
  const [q, set] = usePeriod();
  const params = useMemo(() => periodParams(q), [q]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState({ decision: "makeup_required", comment: "" });
  const [makeup, setMakeup] = useState(null);
  const [correcting, setCorrecting] = useState(null);

  function load() {
    if (!periodReady(q)) return;
    client
      .get(`/admin/punctuality/${id}`, { params })
      .then((r) => {
        setData(r.data);
        setError("");
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }
  useEffect(load, [id, params]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn, msg) {
    try {
      await fn();
      toast.success(msg);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns = useMemo(
    () => [
      { accessorKey: "date", header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />, meta: { label: "Date" }, cell: ({ row }) => `${row.original.day} ${row.original.date}` },
      { accessorKey: "course_name", header: "Course", meta: { label: "Course" }, cell: ({ row }) => `${row.original.course_name} (${row.original.class_name})` },
      { accessorKey: "scheduled_start", header: "Starts", meta: { label: "Starts" } },
      { accessorKey: "checkin_at", header: "Arrived", meta: { label: "Arrived" }, cell: ({ getValue }) => getValue() || "—" },
      {
        accessorKey: "late_minutes",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Late min." />,
        meta: { label: "Late minutes" },
        cell: ({ getValue }) => (getValue() > 0 ? <span className="font-semibold text-warning">{getValue()}</span> : 0),
      },
      { id: "status", accessorKey: "status_label", header: "Status", meta: { label: "Status" }, cell: ({ row }) => <Badge variant={CATEGORIES[row.original.category]?.variant}>{row.original.status_label}</Badge> },
      { accessorKey: "delivery_mode", header: "Mode", meta: { label: "Mode" }, cell: ({ getValue }) => (getValue() === "online" ? <Badge variant="info">Online</Badge> : "Campus") },
      {
        id: "fix",
        header: "",
        meta: { noExport: true },
        cell: ({ row }) =>
          canEdit && row.original.record_id && row.original.session_number === 1 ? (
            <Button size="sm" variant="ghost" onClick={() => setCorrecting({ id: row.original.record_id, date: row.original.date, checkin_at: row.original.checkin_at || "", checkout_at: row.original.checkout_at || "", reason: "" })}>
              <Pencil /> Correct
            </Button>
          ) : null,
      },
    ],
    [canEdit]
  );

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading...</p>;
  const s = data.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Punctuality: ${data.lecturer.name}`}
        description={`${data.label}. Every ${s.minutes_per_equivalent_session} late minutes = one equivalent session.`}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link to="/admin/punctuality">
                <ArrowLeft /> All lecturers
              </Link>
            </Button>
            <ExportMenu url={`/admin/punctuality/${id}/export`} params={params} name="Punctuality" />
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PeriodFields q={q} set={set} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Late minutes" value={s.late_minutes} tone="text-warning" />
        <Stat label="Equivalent sessions" value={s.equivalent_sessions} />
        <Stat label="Scheduled" value={s.scheduled_sessions} />
        <Stat label="Conducted" value={s.conducted_sessions} tone="text-success" />
        <Stat label="Absences" value={s.absences} tone="text-danger" />
        <Stat label="Makeups assigned" value={s.makeup_assigned} />
        <Stat label="Makeups completed" value={s.makeup_completed} tone="text-success" />
        <Stat label="Outstanding" value={s.makeup_outstanding} tone={s.makeup_outstanding ? "text-danger" : ""} />
      </div>
      {s.needs_review && <Alert variant="error">These late minutes reach {s.equivalent_sessions} equivalent session(s) and need Academic Office review.</Alert>}

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Academic Office review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={review.decision} onValueChange={(v) => setReview((r) => ({ ...r, decision: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISIONS.map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Comment" value={review.comment} onChange={(e) => setReview((r) => ({ ...r, comment: e.target.value }))} />
              <Button size="sm" onClick={() => act(() => client.post(`/admin/punctuality/${id}/review`, review, { params }), "Review recorded; the lecturer has been told")}>
                <Check /> Record review
              </Button>
              {data.reviews.map((r) => (
                <p key={r.id} className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}: {r.decision_label} for {r.late_minutes} min ({r.period_from} – {r.period_to}) by {r.reviewed_by_name}
                  {r.comment ? ` — ${r.comment}` : ""}
                </p>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Makeup sessions</CardTitle>
              <Button size="sm" onClick={() => setMakeup({ timetable_id: data.classes[0]?.id ? String(data.classes[0].id) : "", scheduled_date: todayIso(), start_time: "", end_time: "", room: "", reason: "late_minutes" })} disabled={!data.classes.length}>
                <CalendarPlus /> Assign
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.makeups.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
              {data.makeups.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <span>
                    {m.scheduled_date} {m.start_time && `${m.start_time}–${m.end_time || ""}`} · {m.course_name} ({m.batch}) · {m.room || "—"} · {m.reason_label}
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge variant={MK_VARIANT[m.status]}>{m.status_label}</Badge>
                    {m.status === "assigned" && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => act(() => client.post(`/admin/makeup-sessions/${m.id}/complete`, {}), "Marked completed")}>
                          <Check />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          const reason = window.prompt("Why is this makeup cancelled?");
                          if (reason) act(() => client.post(`/admin/makeup-sessions/${m.id}/cancel`, { reason }), "Cancelled; students told");
                        }}>
                          <X />
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Session-by-session attendance and lateness</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data.sessions} getRowId={(r, i) => String(i)} exportName="lecturer-sessions" emptyText="No sessions in this period." pageSize={20} />
        </CardContent>
      </Card>

      {data.corrections.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Corrections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {data.corrections.map((c) => (
              <p key={c.id}>
                {new Date(c.created_at).toLocaleString()} · {c.actor_name}: {JSON.stringify(c.old_value)} → {JSON.stringify(c.new_value)} ({c.reason})
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {makeup && (
        <Dialog open onOpenChange={(o) => !o && setMakeup(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Assign a makeup session</DialogTitle>
              <DialogDescription>The lecturer and the students of the class are told the date, time and room.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Class</Label>
                <Select value={makeup.timetable_id} onValueChange={(v) => setMakeup((m) => ({ ...m, timetable_id: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.classes.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.course_name} ({c.batch})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" min={todayIso()} value={makeup.scheduled_date} onChange={(e) => setMakeup((m) => ({ ...m, scheduled_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Room</Label>
                <Input value={makeup.room} onChange={(e) => setMakeup((m) => ({ ...m, room: e.target.value }))} placeholder="Default: the class's room" />
              </div>
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input type="time" value={makeup.start_time} onChange={(e) => setMakeup((m) => ({ ...m, start_time: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input type="time" value={makeup.end_time} onChange={(e) => setMakeup((m) => ({ ...m, end_time: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Reason</Label>
                <Select value={makeup.reason} onValueChange={(v) => setMakeup((m) => ({ ...m, reason: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="late_minutes">Accumulated late minutes</SelectItem>
                    <SelectItem value="missed_session">Missed session</SelectItem>
                    <SelectItem value="cancelled_session">Cancelled session</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMakeup(null)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  act(async () => {
                    await client.post("/admin/makeup-sessions", { ...makeup, lecturer_id: Number(id), timetable_id: Number(makeup.timetable_id), start_time: makeup.start_time || null, end_time: makeup.end_time || null });
                    setMakeup(null);
                  }, "Makeup assigned; lecturer and students told")
                }
              >
                Assign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {correcting && (
        <Dialog open onOpenChange={(o) => !o && setCorrecting(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Correct attendance: {correcting.date}</DialogTitle>
              <DialogDescription>Status and late minutes are recalculated. The change and its reason are kept in the corrections log.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Checked in</Label>
                <Input type="time" value={correcting.checkin_at} onChange={(e) => setCorrecting((c) => ({ ...c, checkin_at: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Checked out</Label>
                <Input type="time" value={correcting.checkout_at} onChange={(e) => setCorrecting((c) => ({ ...c, checkout_at: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Reason (required)</Label>
                <Input value={correcting.reason} onChange={(e) => setCorrecting((c) => ({ ...c, reason: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCorrecting(null)}>
                Cancel
              </Button>
              <Button
                disabled={!correcting.reason.trim()}
                onClick={() =>
                  act(async () => {
                    await client.put(`/admin/attendance/${correcting.id}/correct`, { checkin_at: correcting.checkin_at || null, checkout_at: correcting.checkout_at || null, reason: correcting.reason });
                    setCorrecting(null);
                  }, "Attendance corrected")
                }
              >
                Save correction
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
