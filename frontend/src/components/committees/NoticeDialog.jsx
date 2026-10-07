import { useEffect, useState } from "react";
import { Megaphone, Pencil } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, FileInput, OptionSelect, useApi } from "@/components/committees/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AUDIENCES, NOTICE_CATEGORIES, toFormData } from "@/lib/committees";

const EMPTY = { title: "", description: "", category: "announcement", audience: "all_staff", committee_id: "" };

/** Share a new notice, or edit one when `notice` is given (every field starts
 * with its current value). */
export function NoticeDialog({ open, onOpenChange, onSaved, notice }) {
  const editing = !!notice;
  const committees = useApi(open ? "/committees/options" : null, []);
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setForm(
      notice
        ? {
            title: notice.title || "",
            description: notice.description || "",
            category: notice.category,
            audience: notice.audience,
            committee_id: notice.committee_id ? String(notice.committee_id) : "",
          }
        : EMPTY
    );
    setFile(null);
    setRemoveFile(false);
  }, [open, notice]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      let res;
      if (editing) {
        const fd = toFormData({ ...form, file, remove_file: removeFile && !file ? "1" : "" });
        fd.set("description", form.description); // toFormData drops empty values; send it so it can be cleared
        res = await client.put(`/notices/${notice.id}`, fd);
        toast.success("Notice updated");
      } else {
        res = await client.post("/notices", toFormData({ ...form, file }));
        toast.success("Published. Recipients are being notified by email.");
      }
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
              {editing ? <Pencil className="h-5 w-5 text-primary" /> : <Megaphone className="h-5 w-5 text-primary" />}
              {editing ? "Edit notice" : "Share information"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes show straight away. Nobody is notified again."
                : "Recipients get a notification and an email at their registered address."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Title" htmlFor="n-title">
            <Input id="n-title" required maxLength={255} value={form.title} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <Field label="Message" htmlFor="n-desc">
            <Textarea id="n-desc" rows={5} value={form.description} onChange={(e) => set("description")(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="n-cat">
              <OptionSelect id="n-cat" value={form.category} onChange={set("category")} options={NOTICE_CATEGORIES.filter((c) => c.value !== "meeting_minutes")} />
            </Field>
            <Field label="Audience" htmlFor="n-aud">
              <OptionSelect id="n-aud" value={form.audience} onChange={set("audience")} options={AUDIENCES} />
            </Field>
          </div>
          {form.audience === "committee" && (
            <Field label="Committee" htmlFor="n-committee">
              <OptionSelect
                id="n-committee"
                value={form.committee_id}
                onChange={set("committee_id")}
                placeholder="Choose a committee"
                options={(committees.data || []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          )}
          <Field
            label={editing && notice.file_name ? "Replace document (optional)" : "Document (optional)"}
            htmlFor="n-file"
            hint={editing && notice.file_name ? `Current: ${notice.file_name}. Leave empty to keep it.` : undefined}
          >
            <FileInput id="n-file" onChange={setFile} />
          </Field>
          {editing && notice.file_name && !file && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={removeFile} onCheckedChange={(v) => setRemoveFile(!!v)} /> Remove the current document
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {editing ? (saving ? "Saving..." : "Save changes") : saving ? "Publishing..." : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
