import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, FileInput, OptionSelect, useApi } from "@/components/committees/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toFormData } from "@/lib/committees";

export const MINUTES_DELETE_TEXT =
  "The minutes, their document and their Information Sharing notice are removed for everyone. This cannot be undone.";

/** Edit published minutes. Loads the current values, so every field starts
 * filled in. Pass the minutes id; null keeps the dialog closed. */
export function MinutesEditDialog({ minutesId, onOpenChange, onSaved }) {
  const open = minutesId != null;
  const current = useApi(open ? `/minutes/${minutesId}` : null);
  const committees = useApi(open ? "/committees/options" : null, []);
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const m = current.data;

  useEffect(() => {
    if (!open) {
      setForm(null);
      setFile(null);
    } else if (m && String(m.id) === String(minutesId)) {
      setForm({
        committee_id: String(m.committee_id),
        title: m.title || "",
        meeting_date: m.meeting_date || "",
        summary: m.summary || "",
        visibility: m.visibility,
      });
    }
  }, [open, m, minutesId]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const body = { ...form, file };
    if (m.meeting_id) delete body.committee_id; // linked to a meeting, so the committee is fixed
    const fd = toFormData(body);
    fd.set("summary", form.summary); // toFormData drops empty values; send it so a summary can be cleared
    try {
      const res = await client.put(`/minutes/${minutesId}`, fd);
      toast.success("Minutes updated");
      onOpenChange(false);
      onSaved?.(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" /> Edit minutes
            </DialogTitle>
            <DialogDescription>Changes also update the Information Sharing notice. Nobody is notified again.</DialogDescription>
          </DialogHeader>
          {current.error && <p className="text-sm text-destructive">{current.error}</p>}
          {!form ? (
            !current.error && <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              {m.meeting_id ? (
                <Field label="Committee" htmlFor="me-committee" hint="Fixed by the linked meeting.">
                  <Input id="me-committee" value={m.committee_name} disabled />
                </Field>
              ) : (
                <Field label="Committee / administrative unit" htmlFor="me-committee">
                  <OptionSelect
                    id="me-committee"
                    value={form.committee_id}
                    onChange={set("committee_id")}
                    options={(committees.data || []).map((c) => ({ value: c.id, label: `${c.name} (${c.kind_label})` }))}
                  />
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title" htmlFor="me-title">
                  <Input id="me-title" required maxLength={255} value={form.title} onChange={(e) => set("title")(e.target.value)} />
                </Field>
                <Field label="Meeting date" htmlFor="me-date">
                  <Input id="me-date" type="date" required value={form.meeting_date} onChange={(e) => set("meeting_date")(e.target.value)} />
                </Field>
              </div>
              <Field label="Summary (optional)" htmlFor="me-summary">
                <Textarea id="me-summary" rows={4} value={form.summary} onChange={(e) => set("summary")(e.target.value)} />
              </Field>
              <Field label="Visibility" htmlFor="me-vis">
                <OptionSelect
                  id="me-vis"
                  value={form.visibility}
                  onChange={set("visibility")}
                  options={[
                    { value: "committee", label: "Committee members only" },
                    { value: "faculty", label: "Faculty-wide" },
                  ]}
                />
              </Field>
              <Field label="Replace document (optional)" htmlFor="me-file" hint={`Current: ${m.file_name}. Leave empty to keep it.`}>
                <FileInput id="me-file" onChange={setFile} />
              </Field>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
