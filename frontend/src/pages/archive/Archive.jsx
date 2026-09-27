import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Archive as ArchiveIcon, CalendarDays, FilePen, FileText, FolderOpen, Mail, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { DocumentActions, Field, FileInput, OptionSelect, useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, toFormData, viewDocument } from "@/lib/committees";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "memo", label: "Memo", plural: "Memos", icon: Mail, hint: "Memos written in the system or uploaded" },
  { value: "agenda", label: "Meeting Agenda", plural: "Meeting Agendas", icon: CalendarDays, hint: "Filed when a meeting is scheduled" },
  { value: "report", label: "Report", plural: "Reports", icon: FileText, hint: "Task reports filed when members complete tasks" },
];
const ALL = "";
const today = () => new Date().toISOString().slice(0, 10);

function sourceBadge(doc) {
  if (doc.task_id) return <Badge variant="success">Task report</Badge>;
  if (doc.meeting_id) return <Badge variant="info">From meeting</Badge>;
  if (doc.source === "created") return <Badge variant="purple">Created in FEBEMS</Badge>;
  return <Badge variant="muted">Uploaded</Badge>;
}

function MemoDialog({ open, onOpenChange, committees, committeeId, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm({ committee_id: committeeId || (committees.length === 1 ? String(committees[0].id) : ""), document_date: today() });
  }, [open, committeeId, committees]);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.committee_id) return toast.error("Choose the committee this memo is from");
    setSaving(true);
    try {
      const res = await client.post("/archive/memos", { ...form, committee_id: Number(form.committee_id) });
      toast.success(`Memo ${res.data.reference_no} created and filed as a PDF`);
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
              <FilePen className="h-5 w-5 text-primary" /> Write a memo
            </DialogTitle>
            <DialogDescription>
              The memo is laid out on the faculty letterhead with a reference number, saved as a PDF and filed in the
              archive.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Committee" htmlFor="memo-committee">
              <OptionSelect
                id="memo-committee"
                value={form.committee_id}
                onChange={set("committee_id")}
                placeholder="Choose a committee"
                options={committees.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Date" htmlFor="memo-date">
              <Input id="memo-date" type="date" required value={form.document_date || ""} onChange={(e) => set("document_date")(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="memo-to">
              <Input id="memo-to" required maxLength={500} placeholder="e.g. All heads of department" value={form.memo_to || ""} onChange={(e) => set("memo_to")(e.target.value)} />
            </Field>
            <Field label="CC (optional)" htmlFor="memo-cc">
              <Input id="memo-cc" maxLength={500} placeholder="e.g. The Dean" value={form.memo_cc || ""} onChange={(e) => set("memo_cc")(e.target.value)} />
            </Field>
            <Field label="From (optional)" htmlFor="memo-from" hint="Left empty: your name, role and committee." className="sm:col-span-2">
              <Input id="memo-from" maxLength={500} value={form.memo_from || ""} onChange={(e) => set("memo_from")(e.target.value)} />
            </Field>
          </div>
          <Field label="Subject" htmlFor="memo-subject">
            <Input id="memo-subject" required maxLength={255} value={form.subject || ""} onChange={(e) => set("subject")(e.target.value)} />
          </Field>
          <Field label="Memo" htmlFor="memo-body">
            <Textarea id="memo-body" required rows={10} maxLength={20000} value={form.body || ""} onChange={(e) => set("body")(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <FilePen /> {saving ? "Creating PDF..." : "Create memo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ open, onOpenChange, committees, committeeId, category, onSaved }) {
  const [form, setForm] = useState({});
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setForm({
      committee_id: committeeId || (committees.length === 1 ? String(committees[0].id) : ""),
      category,
      document_date: today(),
    });
  }, [open, committeeId, committees, category]);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.committee_id) return toast.error("Choose a committee");
    if (!file) return toast.error("Choose the file to upload");
    setSaving(true);
    try {
      const res = await client.post("/archive", toFormData({ ...form, file }));
      toast.success("Document added to the archive");
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
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" /> Upload to the archive
            </DialogTitle>
            <DialogDescription>A signed memo, an agenda prepared elsewhere or any other report, as PDF, Word, Excel, PowerPoint or an image.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Committee" htmlFor="up-committee">
              <OptionSelect
                id="up-committee"
                value={form.committee_id}
                onChange={set("committee_id")}
                placeholder="Choose a committee"
                options={committees.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Type" htmlFor="up-category">
              <OptionSelect id="up-category" value={form.category} onChange={set("category")} options={CATEGORIES} />
            </Field>
            <Field label="Date" htmlFor="up-date">
              <Input id="up-date" type="date" required value={form.document_date || ""} onChange={(e) => set("document_date")(e.target.value)} />
            </Field>
            <Field label="Reference (optional)" htmlFor="up-ref" hint="Left empty: numbered automatically.">
              <Input id="up-ref" maxLength={100} value={form.reference_no || ""} onChange={(e) => set("reference_no")(e.target.value)} />
            </Field>
          </div>
          <Field label="Title" htmlFor="up-title">
            <Input id="up-title" required maxLength={255} value={form.title || ""} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <Field label="Summary (optional)" htmlFor="up-summary">
            <Textarea id="up-summary" rows={2} maxLength={5000} value={form.summary || ""} onChange={(e) => set("summary")(e.target.value)} />
          </Field>
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

/**
 * One archive for each committee's memos, meeting agendas and reports.
 * Chairpersons and secretaries see their own committees; admins, the Dean
 * and the Administration Team see every committee. The API enforces this.
 */
export default function Archive() {
  const [params, setParams] = useSearchParams();
  const committeeId = params.get("committee") || ALL;
  const category = params.get("type") || "memo";
  const [q, setQ] = useState("");
  const [memoOpen, setMemoOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const committees = useApi("/archive/committees", []);
  const list = committees.data || [];
  const query = new URLSearchParams({ category, ...(committeeId ? { committee_id: committeeId } : {}) });
  const docs = useApi(`/archive?${query}`, []);

  // Someone with a single committee lands straight in it.
  useEffect(() => {
    if (!committeeId && list.length === 1) setParams((p) => ({ ...Object.fromEntries(p), committee: String(list[0].id) }), { replace: true });
  }, [committeeId, list, setParams]);

  const selected = list.find((c) => String(c.id) === committeeId);
  const addable = list.filter((c) => c.can_add);
  const canAdd = selected ? selected.can_add : addable.length > 0;
  const counts = useMemo(() => {
    const scope = selected ? [selected] : list;
    return Object.fromEntries(CATEGORIES.map((c) => [c.value, scope.reduce((n, x) => n + (x.counts?.[c.value] || 0), 0)]));
  }, [selected, list]);

  const setParam = (key, value) =>
    setParams((p) => {
      const next = Object.fromEntries(p);
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });

  const refresh = () => {
    docs.reload();
    committees.reload();
  };

  async function remove(doc) {
    try {
      await client.delete(`/archive/${doc.id}`);
      toast.success("Removed from the archive");
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return docs.data || [];
    return (docs.data || []).filter((d) =>
      `${d.reference_no} ${d.title} ${d.summary || ""} ${d.committee_name} ${d.created_by_name || ""}`.toLowerCase().includes(needle)
    );
  }, [docs.data, q]);

  const columns = useMemo(
    () =>
      [
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
            <button
              type="button"
              className="min-w-[200px] text-left"
              onClick={() => viewDocument(row.original.url).catch((err) => toast.error(apiErrorMessage(err)))}
            >
              <p className="font-medium hover:text-primary hover:underline">{row.original.title}</p>
              {row.original.category === "memo" && row.original.memo_to && (
                <p className="text-xs text-muted-foreground">To: {row.original.memo_to}</p>
              )}
              {row.original.task_id && (
                <Link to={`/tasks/${row.original.task_id}`} className="text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                  Open task
                </Link>
              )}
              {row.original.meeting_id && (
                <Link to={`/meetings/${row.original.meeting_id}`} className="text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                  Open meeting
                </Link>
              )}
            </button>
          ),
        },
        !selected && {
          accessorKey: "committee_name",
          header: ({ column }) => <DataTableColumnHeader column={column} title="Committee" />,
          meta: { label: "Committee" },
          filterFn: exactFilter,
        },
        {
          accessorKey: "document_date",
          header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
          meta: { label: "Date", exportValue: (r) => formatDate(r.document_date) },
          cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.document_date)}</span>,
        },
        {
          id: "source",
          accessorFn: (r) => (r.task_id ? "Task report" : r.meeting_id ? "From meeting" : r.source === "created" ? "Created in FEBEMS" : "Uploaded"),
          header: "Source",
          meta: { label: "Source" },
          cell: ({ row }) => sourceBadge(row.original),
        },
        {
          accessorKey: "created_by_name",
          header: "Filed by",
          meta: { label: "Filed by" },
          cell: ({ getValue }) => getValue() || "System",
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
              {row.original.can_delete && !row.original.task_id && !row.original.meeting_id && (
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Remove" onClick={() => setToDelete(row.original)}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ),
        },
      ].filter(Boolean),
    [selected]
  );

  const current = CATEGORIES.find((c) => c.value === category) || CATEGORIES[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Committee archive"
        description="Memos, meeting agendas and reports of each committee, kept in one place."
        actions={
          canAdd && (
            <>
              {category === "memo" && (
                <Button onClick={() => setMemoOpen(true)}>
                  <FilePen /> Write memo
                </Button>
              )}
              <Button variant={category === "memo" ? "outline" : "default"} onClick={() => setUploadOpen(true)}>
                <Upload /> Upload
              </Button>
            </>
          )
        }
      />

      {committees.error && <Alert>{committees.error}</Alert>}

      {!committees.loading && list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <ArchiveIcon className="h-10 w-10 text-muted-foreground/60" />
          <p className="max-w-md text-sm text-muted-foreground">
            The archive is open to each committee's chairperson and secretary, system administrators, the Dean and the
            Administration Team.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Committee" htmlFor="ar-committee" className="w-full sm:w-80">
              <OptionSelect
                id="ar-committee"
                value={committeeId}
                onChange={(v) => setParam("committee", v)}
                anyLabel={list.length > 1 ? "All my committees" : undefined}
                placeholder="Choose a committee"
                options={list.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search title, reference..." className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3" role="tablist" aria-label="Document type">
            {CATEGORIES.map((c, i) => {
              const active = c.value === category;
              const Icon = c.icon;
              return (
                <motion.button
                  key={c.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setParam("type", c.value)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-4 text-left transition-all hover:shadow-md",
                    active ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "bg-card"
                  )}
                >
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{c.plural}</span>
                      <Badge variant={active ? "default" : "muted"}>{counts[c.value] ?? 0}</Badge>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </motion.button>
              );
            })}
          </div>

          {docs.error && <Alert>{docs.error}</Alert>}

          <DataTable
            columns={columns}
            data={rows}
            loading={docs.loading}
            getRowId={(r) => String(r.id)}
            filters={selected ? [] : [{ columnId: "committee_name", label: "Committee" }]}
            exportName={`archive-${category}`}
            emptyText={
              <span className="flex flex-col items-center gap-2 py-6">
                <FolderOpen className="h-8 w-8 text-muted-foreground/60" />
                No {current.plural.toLowerCase()} {selected ? `for ${selected.name}` : ""} yet.
              </span>
            }
          />
        </>
      )}

      <MemoDialog open={memoOpen} onOpenChange={setMemoOpen} committees={addable} committeeId={selected?.can_add ? committeeId : ""} onSaved={refresh} />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        committees={addable}
        committeeId={selected?.can_add ? committeeId : ""}
        category={category}
        onSaved={refresh}
      />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Remove this document?"
        description={toDelete ? `${toDelete.reference_no} — ${toDelete.title} will be removed from the archive.` : ""}
        confirmLabel="Remove"
        onConfirm={() => remove(toDelete)}
      />
    </div>
  );
}
