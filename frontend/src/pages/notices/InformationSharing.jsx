import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, Paperclip } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import { MINUTES_DELETE_TEXT, MinutesEditDialog } from "@/components/committees/MinutesEditDialog.jsx";
import { NoticeDialog } from "@/components/committees/NoticeDialog.jsx";
import { RowActions, actionsColumn } from "@/components/committees/RowActions.jsx";
import { useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUDIENCES, NOTICE_CATEGORIES, formatDateTime, labelOf } from "@/lib/committees";

export default function InformationSharing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingMinutesId, setEditingMinutesId] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const params = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v));
  const { data, loading, error, reload } = useApi(`/notices?${params}`, []);
  const canShare = user?.capabilities?.can_share_information;

  async function remove(post) {
    try {
      await client.delete(`/notices/${post.id}`);
      toast.success(post.minutes_id ? "Minutes deleted" : "Notice deleted");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

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
      actionsColumn((p) => (
        <RowActions
          onEdit={p.can_edit ? () => (p.minutes_id ? setEditingMinutesId(p.minutes_id) : setEditing(p)) : null}
          onDelete={p.can_delete ? () => setToDelete(p) : null}
        />
      )),
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
      <NoticeDialog open={open} onOpenChange={setOpen} onSaved={reload} />
      <NoticeDialog open={!!editing} notice={editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={reload} />
      <MinutesEditDialog minutesId={editingMinutesId} onOpenChange={(o) => !o && setEditingMinutesId(null)} onSaved={reload} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete "${toDelete?.title}"?`}
        description={
          toDelete?.minutes_id
            ? MINUTES_DELETE_TEXT
            : "The notice and its attached document are removed for everyone. This cannot be undone."
        }
        confirmLabel="Delete"
        onConfirm={() => remove(toDelete)}
      />
    </div>
  );
}
