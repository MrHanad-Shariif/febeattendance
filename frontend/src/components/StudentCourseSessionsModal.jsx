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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EDITABLE_STATUSES = ["on_time", "late", "absent", "present"];
const LABELS = { ...STATUS_LABELS, present: "Present (excused)" };

function SessionRow({ record, onSaved, apiBase }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(record.status);
  const [remarks, setRemarks] = useState(record.remarks || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!remarks.trim()) {
      setError("A remark explaining the change is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await client.put(`${apiBase}/student-attendance/${record.id}`, { status, remarks });
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
      <TableCell>{record.date}</TableCell>
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
          <StatusBadge status={record.status} label={record.status_label} />
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Required, e.g. Approved makeup"
            className="h-8 text-xs"
          />
        ) : (
          <>
            <span className="text-xs text-muted-foreground">{record.remarks || "—"}</span>
            {record.modified_by_name && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                Changed by {record.modified_by_name} ({record.modified_by_role})
              </p>
            )}
          </>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </TableCell>
      <TableCell>
        {editing ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function StudentCourseSessionsModal({ batch, courseName, studentId, studentName, onClose, apiBase }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get(`${apiBase}/student-sessions`, { params: { batch, course_name: courseName, student_id: studentId } })
      .then((res) => setRecords(res.data))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [batch, courseName, studentId, apiBase]);

  function handleSaved(updated) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{studentName}</DialogTitle>
          <DialogDescription>
            {courseName} · {batch}
          </DialogDescription>
        </DialogHeader>

        {error && <Alert>{error}</Alert>}
        {!records && !error && <Skeleton className="h-40 w-full" />}

        {records && (
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[520px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <SessionRow key={r.id} record={r} onSaved={handleSaved} apiBase={apiBase} />
                ))}
                {records.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No sessions recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
