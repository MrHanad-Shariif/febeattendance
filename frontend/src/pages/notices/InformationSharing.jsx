import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, Paperclip } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import { Field, FileInput, OptionSelect, useApi } from "@/components/committees/shared";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AUDIENCES, NOTICE_CATEGORIES, formatDateTime, labelOf, toFormData } from "@/lib/committees";

function PublishDialog({ open, onOpenChange, onSaved }) {
  const committees = useApi(open ? "/committees/options" : null, []);
  const [form, setForm] = useState({ title: "", description: "", category: "announcement", audience: "all_staff", committee_id: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await client.post("/notices", toFormData({ ...form, file }));
      toast.success("Published. Recipients are being notified by email.");
      setForm({ title: "", description: "", category: "announcement", audience: "all_staff", committee_id: "" });
      setFile(null);
      onOpenChange(false);
      onSaved();
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
              <Megaphone className="h-5 w-5 text-primary" /> Share information
            </DialogTitle>
            <DialogDescription>Recipients get a notification and an email at their registered address.</DialogDescription>
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
          <Field label="Document (optional)" htmlFor="n-file">
            <FileInput id="n-file" onChange={setFile} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Publishing..." : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function InformationSharing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(false);
  const params = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v));
  const { data, loading, error, reload } = useApi(`/notices?${params}`, []);
  const canShare = user?.capabilities?.can_share_information;

  const columns = useMemo(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        meta: { label: "Title" },
        cell: ({ row }) => (
          <div className="min-w-[200px]">
            <p className="flex items-center gap-1.5 font-medium">
              {row.original.title}
              {row.original.url && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
            </p>
            {row.original.description && <p className="line-clamp-1 text-xs text-muted-foreground">{row.original.description}</p>}
          </div>
        ),
      },
      {
        id: "category",
        accessorFn: (r) => labelOf(NOTICE_CATEGORIES, r.category),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        meta: { label: "Category" },
        filterFn: exactFilter,
        cell: ({ getValue, row }) => <Badge variant={row.original.category === "meeting_minutes" ? "purple" : "default"}>{getValue()}</Badge>,
      },
      {
        id: "audience",
        accessorFn: (r) => (r.audience === "committee" ? r.committee_name : labelOf(AUDIENCES, r.audience)),
        header: "Audience",
        meta: { label: "Audience" },
      },
      { accessorKey: "published_by_name", header: "Published by", meta: { label: "Published by" } },
      {
        accessorKey: "published_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        meta: { label: "Date", exportValue: (r) => formatDateTime(r.published_at) },
        cell: ({ row }) => formatDateTime(row.original.published_at),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Information sharing"
        description="Faculty notices and announcements. Published meeting minutes also appear here."
        actions={
          canShare && (
            <Button onClick={() => setOpen(true)}>
              <Megaphone /> Share information
            </Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      <DataTable
        columns={columns}
        data={data || []}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search by keyword..."
        filters={[{ columnId: "category", label: "Category" }]}
        toolbar={
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
        }
        exportName="information-sharing"
        onRowClick={(p) => navigate(p.minutes_id ? `/meeting-minutes/${p.minutes_id}` : `/information/${p.id}`)}
        initialSorting={[{ id: "published_at", desc: true }]}
        emptyText="Nothing has been shared yet."
      />
      <PublishDialog open={open} onOpenChange={setOpen} onSaved={reload} />
    </div>
  );
}
