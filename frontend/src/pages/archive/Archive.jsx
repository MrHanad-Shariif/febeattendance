import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Archive as ArchiveIcon,
  CalendarDays,
  CheckCircle2,
  FilePen,
  FileStack,
  FileText,
  FolderOpen,
  History,
  Lock,
  Mail,
  NotebookText,
  Pencil,
  Search,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DocumentActions, Field, FileInput, OptionSelect, useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, toFormData, viewDocument } from "@/lib/committees";
import { cn } from "@/lib/utils";

const TYPES = [
  { value: "", label: "All documents", icon: FileStack },
  { value: "memo", label: "Memos", icon: Mail },
  { value: "agenda", label: "Meeting Agendas", icon: CalendarDays },
  { value: "minutes", label: "Meeting Minutes", icon: NotebookText },
  { value: "report", label: "Reports", icon: FileText },
  { value: "other", label: "Other", icon: FolderOpen },
];
const DOC_TYPES = [
  { value: "memo", label: "Memo" },
  { value: "agenda", label: "Meeting Agenda" },
  { value: "minutes", label: "Meeting Minutes" },
  { value: "report", label: "Report" },
  { value: "other", label: "Other (specify)" },
];
const STATUS_VARIANTS = { draft: "warning", issued: "info", archived: "success" };
const OFFICE = "none";
const today = () => new Date().toISOString().slice(0, 10);

function academicYear() {
  const d = new Date();
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
}

function StatusBadge({ doc }) {
  return <Badge variant={STATUS_VARIANTS[doc.status] || "muted"}>{doc.status_label}</Badge>;
}

/** Committee or office the document is filed for. */
function OwnerFields({ form, set, committees, options }) {
  const owners = [
    ...(options.can_file_office ? [{ value: OFFICE, label: "An office (not a committee)" }] : []),
    ...committees.map((c) => ({ value: String(c.id), label: c.name })),
  ];
  return (
    <>
      <Field label="Filed for" htmlFor="own">
        <OptionSelect id="own" value={form.committee_id} onChange={set("committee_id")} placeholder="Choose..." options={owners} />
      </Field>
      <Field label={form.committee_id === OFFICE ? "Sending office" : "Sending office (optional)"} htmlFor="office">
        <Input
          id="office"
          list="archive-offices"
          maxLength={200}
          placeholder="e.g. Office of the Dean"
          value={form.sending_office || ""}
          onChange={(e) => set("sending_office")(e.target.value)}
          required={form.committee_id === OFFICE}
        />
        <datalist id="archive-offices">
          {[...new Set(["Office of the Dean", "Academic Office", "Examinations Office", "Faculty Administration", ...(options.offices || [])])].map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </Field>
    </>
  );
}

/** The descriptive fields every document type shares. */
function MetaFields({ form, set, options }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Recipient (office, department, committee or person)" htmlFor="rcpt" className="sm:col-span-2">
        <Input id="rcpt" maxLength={500} value={form.recipient || ""} onChange={(e) => set("recipient")(e.target.value)} />
      </Field>
      <Field label="Department (optional)" htmlFor="dept">
        <OptionSelect id="dept" value={form.department} onChange={set("department")} anyLabel="—" options={(options.departments || []).map((d) => ({ value: d, label: d }))} />
      </Field>
      <Field label="Academic year" htmlFor="ay">
        <Input id="ay" maxLength={20} placeholder="2026/2027" value={form.academic_year || ""} onChange={(e) => set("academic_year")(e.target.value)} />
      </Field>
      <Field label="Prepared by" htmlFor="prep">
        <Input id="prep" maxLength={200} value={form.prepared_by || ""} onChange={(e) => set("prepared_by")(e.target.value)} />
      </Field>
      <Field label="Approved by" htmlFor="appr">
        <Input id="appr" maxLength={200} value={form.approved_by || ""} onChange={(e) => set("approved_by")(e.target.value)} />
      </Field>
      <Field label="Keywords / tags (comma separated)" htmlFor="tags" className="sm:col-span-2">
        <Input id="tags" maxLength={500} placeholder="accreditation, ministry" value={form.tags || ""} onChange={(e) => set("tags")(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox checked={!!form.confidential} onCheckedChange={(v) => set("confidential")(v === true)} />
        <Lock className="h-4 w-4 text-muted-foreground" /> Confidential: only people with the confidential-documents permission can open it
      </label>
    </div>
  );
}

function initialOwner(committees, options, committeeId) {
  if (committeeId && committeeId !== OFFICE && committees.some((c) => String(c.id) === committeeId)) return committeeId;
  if (options.can_file_office) return OFFICE;
  return committees.length === 1 ? String(committees[0].id) : "";
}

function MemoDialog({ open, onOpenChange, committees, options, committeeId, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm({ committee_id: initialOwner(committees, options, committeeId), document_date: today(), academic_year: academicYear() });
  }, [open, committeeId, committees, options]);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(status) {
    if (!form.committee_id) return toast.error("Choose who the memo is from");
    setSaving(true);
    try {
      const body = { ...form, status, committee_id: form.committee_id === OFFICE ? null : Number(form.committee_id) };
      const res = await client.post("/archive/memos", body);
      toast.success(`Memo ${res.data.reference_no} saved as ${res.data.status_label.toLowerCase()}`);
      onOpenChange(false);
      onSaved(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.nativeEvent.submitter?.value || "draft");
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePen className="h-5 w-5 text-primary" /> Write a memo
            </DialogTitle>
            <DialogDescription>Laid out on the faculty letterhead with a reference number and saved as a PDF. Keep it as a draft until it is final.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <OwnerFields form={form} set={set} committees={committees} options={options} />
            <Field label="Date" htmlFor="memo-date">
              <Input id="memo-date" type="date" required value={form.document_date || ""} onChange={(e) => set("document_date")(e.target.value)} />
            </Field>
            <Field label="Reference (optional)" htmlFor="memo-ref" hint="Left empty: numbered automatically.">
              <Input id="memo-ref" maxLength={100} value={form.reference_no || ""} onChange={(e) => set("reference_no")(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="memo-to">
              <Input id="memo-to" required maxLength={500} placeholder="e.g. Registrar's Office" value={form.memo_to || ""} onChange={(e) => set("memo_to")(e.target.value)} />
            </Field>
            <Field label="CC (optional)" htmlFor="memo-cc">
              <Input id="memo-cc" maxLength={500} value={form.memo_cc || ""} onChange={(e) => set("memo_cc")(e.target.value)} />
            </Field>
            <Field label="From (optional)" htmlFor="memo-from" hint="Left empty: your name and office or committee." className="sm:col-span-2">
              <Input id="memo-from" maxLength={500} value={form.memo_from || ""} onChange={(e) => set("memo_from")(e.target.value)} />
            </Field>
          </div>
          <Field label="Subject" htmlFor="memo-subject">
            <Input id="memo-subject" required maxLength={255} value={form.subject || ""} onChange={(e) => set("subject")(e.target.value)} />
          </Field>
          <Field label="Memo" htmlFor="memo-body">
            <Textarea id="memo-body" required rows={8} maxLength={20000} value={form.body || ""} onChange={(e) => set("body")(e.target.value)} />
          </Field>
          <MetaFields form={form} set={set} options={options} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" value="draft" variant="outline" disabled={saving}>
              Save draft
            </Button>
            <Button type="submit" value="issued" variant="outline" disabled={saving}>
              <Send /> Issue
            </Button>
            <Button type="submit" value="archived" disabled={saving}>
              <ArchiveIcon /> Issue and archive
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ open, onOpenChange, committees, options, committeeId, category, onSaved }) {
  const [form, setForm] = useState({});
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setForm({
      committee_id: initialOwner(committees, options, committeeId),
      category: category || "",
      document_date: today(),
      academic_year: academicYear(),
      status: "archived",
    });
  }, [open, committeeId, committees, category, options]);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.committee_id) return toast.error("Choose who the document is filed for");
    if (!form.category) return toast.error("Choose the document type");
    if (form.category === "other" && !form.other_type?.trim()) return toast.error("Say what kind of document it is");
    if (!file) return toast.error("Choose the file to upload");
    setSaving(true);
    try {
      const res = await client.post("/archive", toFormData({ ...form, confidential: form.confidential ? "true" : "", file }));
      toast.success(`Filed as ${res.data.reference_no}`);
      onOpenChange(false);
      onSaved(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" /> Upload to the archive
            </DialogTitle>
            <DialogDescription>A signed memo, a letter, minutes, a report or any other official document: PDF, Word, Excel, PowerPoint or an image.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <OwnerFields form={form} set={set} committees={committees} options={options} />
            <Field label="Document type" htmlFor="up-type">
              <OptionSelect id="up-type" value={form.category} onChange={set("category")} options={DOC_TYPES} placeholder="Choose a type" />
            </Field>
            {form.category === "other" ? (
              <Field label="Which kind of document?" htmlFor="up-other">
                <Input
                  id="up-other"
                  list="other-types"
                  required
                  maxLength={100}
                  placeholder="e.g. Official letter"
                  value={form.other_type || ""}
                  onChange={(e) => set("other_type")(e.target.value)}
                />
                <datalist id="other-types">
                  {["Official letter", "Report", "Circular", "Notice", "Proposal", "Correspondence", "Policy"].map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Field label="Date" htmlFor="up-date">
              <Input id="up-date" type="date" required value={form.document_date || ""} onChange={(e) => set("document_date")(e.target.value)} />
            </Field>
            <Field label="Reference (optional)" htmlFor="up-ref" hint="Left empty: numbered automatically.">
              <Input id="up-ref" maxLength={100} value={form.reference_no || ""} onChange={(e) => set("reference_no")(e.target.value)} />
            </Field>
            <Field label="Status" htmlFor="up-status">
              <OptionSelect id="up-status" value={form.status} onChange={set("status")} options={options.statuses || []} />
            </Field>
          </div>
          <Field label="Title / subject" htmlFor="up-title">
            <Input id="up-title" required maxLength={255} value={form.title || ""} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <Field label="Description (optional)" htmlFor="up-summary">
            <Textarea id="up-summary" rows={2} maxLength={5000} value={form.summary || ""} onChange={(e) => set("summary")(e.target.value)} />
          </Field>
          <MetaFields form={form} set={set} options={options} />
          <Field label="File" htmlFor="up-file">
            <FileInput id="up-file" onChange={setFile} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Upload /> {saving ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const VERSION_LABELS = { created: "Filed", edited: "Details changed", replaced: "New file / text", issued: "Issued", archived: "Archived" };

function DetailDialog({ id, onClose, onChanged, options }) {
  const [doc, setDoc] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [newFile, setNewFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function load() {
    client
      .get(`/archive/${id}`)
      .then((r) => setDoc(r.data))
      .catch((err) => toast.error(apiErrorMessage(err)));
  }
  useEffect(() => {
    if (!id) return;
    setDoc(null);
    setEditing(false);
    setNewFile(null);
    setForm({});
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  function startEdit() {
    setForm({ ...doc, tags: (doc.tags || []).join(", "), change_note: "" });
    setEditing(true);
  }

  async function run(fn, success) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      load();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const generatedMemo = doc?.category === "memo" && doc?.source === "created";
  const systemFiled = doc && (doc.meeting_id || doc.task_id || doc.minutes_id);

  const saveEdit = () =>
    run(async () => {
      const keys = ["title", "reference_no", "document_date", "sending_office", "recipient", "department", "prepared_by", "approved_by", "tags", "academic_year", "confidential", "change_note"];
      if (doc.category === "other") keys.push("other_type");
      if (generatedMemo) keys.push("memo_to", "memo_from", "memo_cc", "body");
      else keys.push("summary");
      await client.put(`/archive/${doc.id}`, Object.fromEntries(keys.map((k) => [k, form[k] ?? ""])));
      setEditing(false);
    }, "Saved. The previous version is kept in the history.");

  const uploadVersion = () =>
    run(async () => {
      await client.put(`/archive/${doc.id}`, toFormData({ file: newFile, change_note: form.change_note }));
      setNewFile(null);
    }, "New file uploaded. The original is kept in the history.");

  const setStatus = (status) => run(() => client.post(`/archive/${doc.id}/status`, { status }), status === "issued" ? "Marked as issued" : "Archived");

  async function remove() {
    try {
      await client.delete(`/archive/${doc.id}`);
      toast.success("Draft deleted");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {doc?.confidential && <Lock className="h-4 w-4 text-danger" />}
            {doc ? doc.title : "Loading..."}
          </DialogTitle>
          {doc && (
            <DialogDescription className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{doc.reference_no}</span> · {doc.type_label} · <StatusBadge doc={doc} /> · version {doc.version}
            </DialogDescription>
          )}
        </DialogHeader>
        {doc && !editing && (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {[
                ["Filed for", doc.committee_name || "Office document"],
                ["Sending office", doc.sending_office],
                ["Recipient", doc.recipient],
                ["Department", doc.department],
                ["Document date", formatDate(doc.document_date)],
                ["Issued", doc.issued_date ? formatDate(doc.issued_date) : "Not yet"],
                ["Archived", doc.archived_at ? formatDateTime(doc.archived_at) : "Not yet"],
                ["Academic year", doc.academic_year],
                ["Prepared by", doc.prepared_by],
                ["Approved by", doc.approved_by],
                ["Filed by", doc.created_by_name || "System"],
                ["Last changed", doc.updated_by_name ? `${doc.updated_by_name}, ${formatDateTime(doc.updated_at)}` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-32 shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{v || "—"}</dd>
                </div>
              ))}
            </dl>
            {doc.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {doc.tags.map((t) => (
                  <Badge key={t} variant="muted">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            {doc.summary && <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{doc.summary}</p>}
            <div className="flex flex-wrap gap-2">
              <DocumentActions url={doc.url} fileName={doc.file_name} />
              {doc.task_id && (
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/tasks/${doc.task_id}`}>Open task</Link>
                </Button>
              )}
              {doc.meeting_id && (
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/meetings/${doc.meeting_id}`}>Open meeting</Link>
                </Button>
              )}
            </div>
            {doc.can_edit && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="outline" onClick={startEdit} disabled={busy}>
                  <Pencil /> Edit details
                </Button>
                {doc.status === "draft" && (
                  <Button size="sm" variant="outline" onClick={() => setStatus("issued")} disabled={busy}>
                    <Send /> Mark as issued / sent
                  </Button>
                )}
                {doc.status !== "archived" && (
                  <Button size="sm" onClick={() => setStatus("archived")} disabled={busy}>
                    <CheckCircle2 /> Archive
                  </Button>
                )}
                {doc.can_delete && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete
                  </Button>
                )}
              </div>
            )}
            {doc.can_edit && !systemFiled && !generatedMemo && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                <Field label="Upload a new version of the file" htmlFor="newv" className="min-w-[240px] flex-1">
                  <FileInput id="newv" onChange={setNewFile} />
                </Field>
                <Input placeholder="What changed? (optional)" className="w-full sm:w-56" value={form.change_note || ""} onChange={(e) => set("change_note")(e.target.value)} />
                <Button size="sm" onClick={uploadVersion} disabled={!newFile || busy}>
                  <Upload /> Upload version
                </Button>
              </div>
            )}
            <div>
              <p className="mb-2 flex items-center gap-2 font-medium">
                <History className="h-4 w-4" /> History
              </p>
              {doc.versions.length === 0 && <p className="text-muted-foreground">Filed before history was kept.</p>}
              <ol className="space-y-2 border-l pl-4">
                {doc.versions.map((v) => (
                  <li key={v.id}>
                    <p>
                      <span className="font-medium">{VERSION_LABELS[v.action] || v.action}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        v{v.version} · {v.actor_name || "System"} · {formatDateTime(v.created_at)}
                      </span>
                    </p>
                    {v.note && <p className="text-muted-foreground">{v.note}</p>}
                    {v.has_file && (
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => viewDocument(`/api/archive/${doc.id}/versions/${v.id}/document`).catch((err) => toast.error(apiErrorMessage(err)))}
                      >
                        Open the earlier file ({v.file_name})
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
        {doc && editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title / subject" htmlFor="e-title" className="sm:col-span-2">
                <Input id="e-title" maxLength={255} value={form.title || ""} onChange={(e) => set("title")(e.target.value)} />
              </Field>
              <Field label="Reference" htmlFor="e-ref">
                <Input id="e-ref" maxLength={100} value={form.reference_no || ""} onChange={(e) => set("reference_no")(e.target.value)} />
              </Field>
              <Field label="Document date" htmlFor="e-date">
                <Input id="e-date" type="date" value={form.document_date || ""} onChange={(e) => set("document_date")(e.target.value)} />
              </Field>
              {doc.category === "other" && (
                <Field label="Which kind of document?" htmlFor="e-other">
                  <Input id="e-other" maxLength={100} value={form.other_type || ""} onChange={(e) => set("other_type")(e.target.value)} />
                </Field>
              )}
              <Field label="Sending office" htmlFor="e-office">
                <Input id="e-office" maxLength={200} value={form.sending_office || ""} onChange={(e) => set("sending_office")(e.target.value)} />
              </Field>
            </div>
            {generatedMemo ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="To" htmlFor="e-to">
                    <Input id="e-to" maxLength={500} value={form.memo_to || ""} onChange={(e) => set("memo_to")(e.target.value)} />
                  </Field>
                  <Field label="CC" htmlFor="e-cc">
                    <Input id="e-cc" maxLength={500} value={form.memo_cc || ""} onChange={(e) => set("memo_cc")(e.target.value)} />
                  </Field>
                  <Field label="From" htmlFor="e-from" className="sm:col-span-2">
                    <Input id="e-from" maxLength={500} value={form.memo_from || ""} onChange={(e) => set("memo_from")(e.target.value)} />
                  </Field>
                </div>
                <Field label="Memo" htmlFor="e-body" hint="Saving makes a new PDF; the earlier one stays in the history.">
                  <Textarea id="e-body" rows={8} value={form.body || ""} onChange={(e) => set("body")(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="Description" htmlFor="e-summary">
                <Textarea id="e-summary" rows={3} value={form.summary || ""} onChange={(e) => set("summary")(e.target.value)} />
              </Field>
            )}
            <MetaFields form={form} set={set} options={options} />
            <Field label="What changed? (kept in the history)" htmlFor="e-note">
              <Input id="e-note" maxLength={500} value={form.change_note || ""} onChange={(e) => set("change_note")(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={busy}>
                Save changes
              </Button>
            </DialogFooter>
          </div>
        )}
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this document?"
          description="It is removed from the archive with its history. Documents filed by the system cannot be deleted."
          confirmLabel="Delete"
          onConfirm={remove}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The faculty archive. Office documents need no committee; committee
 * documents stay visible to that committee's officers as before. The API
 * enforces every permission, including confidential documents.
 */
export default function Archive() {
  const [params, setParams] = useSearchParams();
  const scope = params.get("committee") || "";
  const category = params.get("type") || "";
  const [f, setF] = useState({ q: "", status: "", academic_year: "", department: "", recipient: "", author: "", from: "", to: "", confidential: "" });
  const [memoOpen, setMemoOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState(null);

  const committees = useApi("/archive/committees", []);
  const optionsApi = useApi("/archive/options", {});
  const options = optionsApi.data || {};
  const list = committees.data || [];
  const query = new URLSearchParams(Object.entries({ committee_id: scope, ...f }).filter(([, v]) => v));
  const docs = useApi(`/archive?${query}`, []);

  const addable = list.filter((c) => c.can_add);
  const canAdd = addable.length > 0 || options.can_file_office;
  const counts = useMemo(() => {
    const c = { "": (docs.data || []).length };
    (docs.data || []).forEach((d) => (c[d.category] = (c[d.category] || 0) + 1));
    return c;
  }, [docs.data]);

  const setParam = (key, value) =>
    setParams((p) => {
      const next = Object.fromEntries(p);
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  const setFilter = (key) => (value) => setF((s) => ({ ...s, [key]: value }));
  const refresh = () => {
    docs.reload();
    committees.reload();
    optionsApi.reload();
  };

  const rows = category ? (docs.data || []).filter((d) => d.category === category) : docs.data || [];

  const columns = useMemo(
    () => [
      {
        accessorKey: "reference_no",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reference" />,
        meta: { label: "Reference" },
        cell: ({ getValue }) => <span className="whitespace-nowrap font-mono text-xs">{getValue() || "—"}</span>,
      },
      {
        accessorKey: "title",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        meta: { label: "Title" },
        cell: ({ row }) => (
          <button type="button" className="min-w-[220px] text-left" onClick={() => setViewing(row.original.id)}>
            <p className="flex items-center gap-1.5 font-medium hover:text-primary hover:underline">
              {row.original.confidential && <Lock className="h-3.5 w-3.5 text-danger" />}
              {row.original.title}
            </p>
            {row.original.recipient && <p className="text-xs text-muted-foreground">To: {row.original.recipient}</p>}
          </button>
        ),
      },
      { accessorKey: "type_label", header: "Type", meta: { label: "Type" } },
      {
        id: "owner",
        accessorFn: (r) => r.committee_name || r.sending_office || "Office",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Committee / office" />,
        meta: { label: "Committee / office" },
      },
      {
        accessorKey: "document_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        meta: { label: "Date", exportValue: (r) => formatDate(r.document_date) },
        cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.document_date)}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { label: "Status", exportValue: (r) => r.status_label },
        cell: ({ row }) => <StatusBadge doc={row.original} />,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "text-right" },
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <DocumentActions url={row.original.url} fileName={row.original.file_name} showName={false} />
            <Button size="sm" variant="ghost" onClick={() => setViewing(row.original.id)}>
              Details
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const scopes = [
    ...(options.can_view_office || options.can_file_office ? [{ value: OFFICE, label: "Office documents (no committee)" }] : []),
    ...list.map((c) => ({ value: String(c.id), label: c.name })),
  ];
  const nothingOpen = !committees.loading && !optionsApi.loading && list.length === 0 && !options.can_view_office && !options.can_file_office;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Archive"
        description="The faculty's official documents in one place: memos, meeting agendas and minutes, reports, letters and more, for offices and committees."
        actions={
          canAdd && (
            <>
              <Button onClick={() => setMemoOpen(true)}>
                <FilePen /> Write memo
              </Button>
              <Button variant="outline" onClick={() => setUploadOpen(true)}>
                <Upload /> Upload document
              </Button>
            </>
          )
        }
      />

      {committees.error && <Alert>{committees.error}</Alert>}

      {nothingOpen ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <ArchiveIcon className="h-10 w-10 text-muted-foreground/60" />
          <p className="max-w-md text-sm text-muted-foreground">
            The archive is open to committee chairpersons and secretaries, the Dean, the Administration Team and staff given archive access.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Document type">
            {TYPES.map((t) => {
              const active = t.value === category;
              const Icon = t.icon;
              return (
                <button
                  key={t.value || "all"}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParam("type", t.value)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    active ? "border-primary bg-primary/5 font-medium text-primary" : "bg-card hover:bg-accent"
                  )}
                >
                  <Icon className="h-4 w-4" /> {t.label}
                  <Badge variant={active ? "default" : "muted"}>{counts[t.value] ?? 0}</Badge>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search title, reference, keywords, office..." className="pl-8" value={f.q} onChange={(e) => setFilter("q")(e.target.value)} />
            </div>
            <OptionSelect value={scope} onChange={(v) => setParam("committee", v)} anyLabel="All committees and offices" options={scopes} />
            <OptionSelect value={f.status} onChange={setFilter("status")} anyLabel="Any status" options={options.statuses || []} />
            <OptionSelect value={f.academic_year} onChange={setFilter("academic_year")} anyLabel="Any academic year" options={(options.academic_years || []).map((y) => ({ value: y, label: y }))} />
            <OptionSelect value={f.department} onChange={setFilter("department")} anyLabel="Any department" options={(options.departments || []).map((d) => ({ value: d, label: d }))} />
            <Input placeholder="Recipient office" value={f.recipient} onChange={(e) => setFilter("recipient")(e.target.value)} />
            <Input placeholder="Author / prepared by" value={f.author} onChange={(e) => setFilter("author")(e.target.value)} />
            <Input type="date" aria-label="From" title="Documents dated from" value={f.from} onChange={(e) => setFilter("from")(e.target.value)} />
            <Input type="date" aria-label="To" title="Documents dated until" value={f.to} onChange={(e) => setFilter("to")(e.target.value)} />
            {options.can_view_confidential && (
              <OptionSelect
                value={f.confidential}
                onChange={setFilter("confidential")}
                anyLabel="Confidential and not"
                options={[
                  { value: "1", label: "Confidential only" },
                  { value: "0", label: "Not confidential" },
                ]}
              />
            )}
          </div>

          {docs.error && <Alert>{docs.error}</Alert>}

          <DataTable
            columns={columns}
            data={rows}
            loading={docs.loading}
            getRowId={(r) => String(r.id)}
            exportName="archive"
            emptyText={
              <span className="flex flex-col items-center gap-2 py-6">
                <FolderOpen className="h-8 w-8 text-muted-foreground/60" />
                No documents match.
              </span>
            }
          />
        </>
      )}

      <MemoDialog open={memoOpen} onOpenChange={setMemoOpen} committees={addable} options={options} committeeId={scope} onSaved={refresh} />
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} committees={addable} options={options} committeeId={scope} category={category} onSaved={refresh} />
      <DetailDialog id={viewing} onClose={() => setViewing(null)} onChanged={refresh} options={options} />
    </div>
  );
}
