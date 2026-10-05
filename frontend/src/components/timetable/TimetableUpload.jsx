import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Alert } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className={`text-lg font-semibold tabular-nums ${tone || ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Upload the faculty's timetable workbook (one sheet per batch). Step 1 reads
 * it and shows what will change; step 2 replaces the timetable.
 */
export default function TimetableUpload({ open, onOpenChange, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [deleteHistory, setDeleteHistory] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  function reset() {
    setFile(null);
    setPreview(null);
    setDeleteHistory(false);
    setError("");
  }

  function body() {
    const fd = new FormData();
    fd.append("file", file);
    if (deleteHistory) fd.append("delete_history", "1");
    return fd;
  }

  async function check() {
    setBusy("preview");
    setError("");
    try {
      setPreview((await client.post("/admin/timetable/upload/preview", body())).data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    setBusy("apply");
    setError("");
    try {
      const res = await client.post("/admin/timetable/upload", body());
      toast.success(`Timetable replaced: ${res.data.counts.classes} classes in ${res.data.counts.batches} batches.`);
      reset();
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  const c = preview?.counts;
  const byBatch = {};
  (preview?.classes || []).forEach((cl) => (byBatch[cl.batch] = (byBatch[cl.batch] || 0) + 1));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload timetable from Excel</DialogTitle>
          <DialogDescription>
            One sheet per batch (the sheet name is the batch, e.g. BCE08 or BTE13&BEE11), with the columns Day, Time,
            Instructor, Subject and Room. The upload replaces the whole timetable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="tt-file">Timetable workbook (.xlsx)</Label>
          <Input
            id="tt-file"
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPreview(null);
              setError("");
            }}
            className="cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
          />
        </div>

        {preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Classes" value={c.classes} />
              <Stat label="Batches" value={c.batches} />
              <Stat label="Lecturer not assigned" value={c.unassigned} tone={c.unassigned ? "text-warning" : ""} />
              <Stat label="Classes removed" value={c.removed} tone={c.removed_with_history ? "text-danger" : ""} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {Object.entries(byBatch).map(([batch, n]) => (
                <Badge key={batch} variant="secondary">
                  {batch} · {n}
                </Badge>
              ))}
            </div>

            <ul className="space-y-1 text-sm text-muted-foreground">
              {c.new_batches > 0 && <li>New batches added to the list: {preview.new_batches.join(", ")}</li>}
              {c.new_rooms > 0 && <li>New rooms added to the list: {preview.new_rooms.join(", ")}</li>}
              {c.new_courses > 0 && <li>{c.new_courses} course(s) added to Courses & lecturers</li>}
              {c.unchanged > 0 && <li>{c.unchanged} unchanged class(es) keep their attendance history</li>}
              {preview.skipped_sheets.length > 0 && <li>Sheets without a timetable, skipped: {preview.skipped_sheets.join(", ")}</li>}
            </ul>

            {preview.unknown_instructors.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-warning">
                  <AlertTriangle className="h-4 w-4" /> Instructors not found among the lecturers
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  Their classes are imported as "not assigned". Add the lecturer (Lecturers → Manage lecturers) and upload
                  again, or pick the lecturer on each class.
                </p>
                <ul className="space-y-0.5">
                  {preview.unknown_instructors.map((u) => (
                    <li key={u.name}>
                      <span className="font-medium">{u.name}</span>{" "}
                      <span className="text-muted-foreground">— {u.classes.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.close_matches?.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer text-muted-foreground">
                  {preview.close_matches.length} instructor name(s) matched by close spelling — please check
                </summary>
                <ul className="mt-1 space-y-0.5 pl-5">
                  {preview.close_matches.map((m) => (
                    <li key={m.excel}>
                      {m.excel} <span className="text-muted-foreground">→</span> <span className="font-medium">{m.lecturer}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {preview.warnings.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{preview.warnings.length} row(s) to check</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}

            {c.removed_with_history > 0 && (
              <div className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
                <p className="font-medium text-danger">
                  {c.removed_with_history} class(es) being removed already have student attendance:
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {preview.removed_with_history.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <label className="flex items-center gap-2">
                  <Checkbox checked={deleteHistory} onCheckedChange={(v) => setDeleteHistory(!!v)} />
                  Also delete their attendance
                </label>
              </div>
            )}

            {c.removed_with_history === 0 && (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> Ready to replace the timetable.
              </p>
            )}
          </div>
        )}

        {error && <Alert>{error}</Alert>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={apply} disabled={!!busy || (c.removed_with_history > 0 && !deleteHistory)}>
              <Upload /> {busy === "apply" ? "Replacing..." : "Replace timetable"}
            </Button>
          ) : (
            <Button onClick={check} disabled={!file || !!busy}>
              <FileSpreadsheet /> {busy === "preview" ? "Reading..." : "Check file"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
