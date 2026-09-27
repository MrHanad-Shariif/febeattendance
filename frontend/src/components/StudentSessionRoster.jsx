import { useEffect, useState } from "react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "../api/client";
import StatusBadge, { STATUS_LABELS } from "./StatusBadge.jsx";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext.jsx";

const EDITABLE_STATUSES = ["on_time", "late", "absent", "present"];
const LABELS = { ...STATUS_LABELS, present: "Present (excused)" };

function RosterRow({ row, onSaved, apiBase }) {
  const { can } = useAuth();
  // Lecturers correct their own students' records; staff need the permission.
  const canEdit = apiBase !== "/admin" || can("student_attendance:edit");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(row.status);
  const [remarks, setRemarks] = useState(row.remarks || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!row.id) {
      setError("This session hasn't been recorded for this student yet (too early to override).");
      return;
    }
    if (!remarks.trim()) {
      setError("A remark explaining the change is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await client.put(`${apiBase}/student-attendance/${row.id}`, { status, remarks });
      onSaved(res.data);
      setEditing(false);
      toast.success("Attendance updated");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow className="align-top">
      <TableCell className="font-medium">{row.student_name}</TableCell>
      <TableCell>
        {row.checkin_at ? new Date(row.checkin_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
        {row.checkin_method && (
          <Badge variant={row.checkin_method === "board" ? "info" : "muted"} className="ml-2">
            {row.checkin_method === "board" ? "Board" : "QR"}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITABLE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {LABELS[s] || s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <StatusBadge status={row.status} label={row.status_label} />
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Required, e.g. Doctor's note provided"
            className="h-8 text-xs"
          />
        ) : (
          <>
            <span className="text-xs text-muted-foreground">{row.remarks || "—"}</span>
            {row.modified_by_name && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                Changed by {row.modified_by_name} ({row.modified_by_role})
              </p>
            )}
          </>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </TableCell>
      <TableCell>
        {!row.id ? (
          <span className="text-xs text-muted-foreground">Not recorded yet</span>
        ) : editing ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        )}
      </TableCell>
    </TableRow>
  );
}

export default function StudentSessionRoster({ timetableId, date, onClose, apiBase = "/admin" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get(`${apiBase}/attendance/students/session/${timetableId}`, { params: { date } })
      .then((res) => setData(res.data))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [timetableId, date, apiBase]);

  function handleSaved(updated) {
    setData((prev) => ({
      ...prev,
      students: prev.students.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
    }));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data?.timetable?.course_name || "Session roster"}</DialogTitle>
          <DialogDescription>
            {data ? `${data.timetable?.batch} · ${data.date} · ${data.timetable?.start_time}–${data.timetable?.end_time}` : "Loading..."}
          </DialogDescription>
        </DialogHeader>

        {error && <Alert>{error}</Alert>}
        {!data && !error && <Skeleton className="h-40 w-full" />}

        {data && (
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[600px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Student</TableHead>
                  <TableHead>Checked in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.students.map((row) => (
                  <RosterRow key={row.student_id} row={row} onSaved={handleSaved} apiBase={apiBase} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
