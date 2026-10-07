import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { NoticeDialog } from "@/components/committees/NoticeDialog.jsx";
import { DocumentActions, useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NOTICE_CATEGORIES, formatDateTime, labelOf } from "@/lib/committees";

export default function NoticeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: p, error, reload } = useApi(`/notices/${id}`);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!p) return <Skeleton className="h-64 w-full" />;

  async function remove() {
    try {
      await client.delete(`/notices/${p.id}`);
      toast.success("Notice deleted");
      navigate("/information");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={p.title}
        description={`${p.published_by_name || "—"} · ${formatDateTime(p.published_at)}`}
        actions={
          !p.minutes_id && (
            <div className="flex flex-wrap gap-2">
              {p.can_edit && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
              )}
              {p.can_delete && (
                <Button variant="outline" className="text-destructive" onClick={() => setConfirm(true)}>
                  <Trash2 /> Delete
                </Button>
              )}
            </div>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Badge>{labelOf(NOTICE_CATEGORIES, p.category)}</Badge>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.description}</p>
          {p.url && <DocumentActions url={p.url} fileName={p.file_name} />}
        </CardContent>
      </Card>
      <NoticeDialog open={editing} notice={p} onOpenChange={setEditing} onSaved={reload} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this notice?" confirmLabel="Delete" onConfirm={remove} />
    </div>
  );
}
