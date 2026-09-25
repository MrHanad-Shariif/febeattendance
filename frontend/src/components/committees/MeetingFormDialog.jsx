import { useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toFormData } from "@/lib/committees";
import { Field, FileInput } from "./shared";

/** Schedule a meeting for committeeId, or edit `meeting`. */
export function MeetingFormDialog({ open, onOpenChange, committeeId, meeting, onSaved }) {
  const editing = !!meeting;
  const [form, setForm] = useState({});
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setForm({
      title: meeting?.title || "",
      date: meeting?.date || "",
      start_time: meeting?.start_time || "",
      end_time: meeting?.end_time || "",
      location: meeting?.location || "",
      agenda: meeting?.agenda || "",
    });
  }, [open, meeting]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    // Send every field when editing so clearing one (e.g. end time) is saved.
    const body = toFormData({ ...form, agenda_file: file });
    if (editing) ["start_time", "end_time", "location", "agenda"].forEach((k) => !form[k] && body.append(k, ""));
    try {
      const res = editing
        ? await client.put(`/meetings/${meeting.id}`, body)
        : await client.post(`/committees/${committeeId}/meetings`, body);
      toast.success(editing ? "Meeting updated. Members have been notified." : "Meeting scheduled. Members have been notified.");
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
              <CalendarPlus className="h-5 w-5 text-primary" /> {editing ? "Edit meeting" : "Schedule meeting"}
            </DialogTitle>
            <DialogDescription>Committee members are notified in the system and by email.</DialogDescription>
          </DialogHeader>
          <Field label="Meeting title" htmlFor="mt-title">
            <Input id="mt-title" required maxLength={255} value={form.title || ""} onChange={set("title")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" htmlFor="mt-date">
              <Input id="mt-date" type="date" required value={form.date || ""} onChange={set("date")} />
            </Field>
            <Field label="Start" htmlFor="mt-start">
              <Input id="mt-start" type="time" value={form.start_time || ""} onChange={set("start_time")} />
            </Field>
            <Field label="End" htmlFor="mt-end">
              <Input id="mt-end" type="time" value={form.end_time || ""} onChange={set("end_time")} />
            </Field>
          </div>
          <Field label="Location" htmlFor="mt-location">
            <Input id="mt-location" maxLength={255} value={form.location || ""} onChange={set("location")} />
          </Field>
          <Field label="Agenda" htmlFor="mt-agenda">
            <Textarea id="mt-agenda" rows={4} value={form.agenda || ""} onChange={set("agenda")} />
          </Field>
          <Field
            label="Agenda document"
            htmlFor="mt-file"
            hint={meeting?.agenda_file_name ? `Current: ${meeting.agenda_file_name}. Choose a file to replace it.` : "PDF, Word or image, up to 15 MB."}
          >
            <FileInput id="mt-file" onChange={setFile} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : editing ? "Save changes" : "Schedule meeting"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
