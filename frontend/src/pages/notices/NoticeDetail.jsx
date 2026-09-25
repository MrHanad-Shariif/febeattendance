import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
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
  const { data: p, error } = useApi(`/notices/${id}`);
  const [confirm, setConfirm] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!p) return <Skeleton className="h-64 w-full" />;

  async function remove() {
    try {
      await client.delete(`/notices/${p.id}`);
      toast.success("Notice removed");
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
          p.can_delete &&
          !p.minutes_id && (
            <Button variant="outline" className="text-destructive" onClick={() => setConfirm(true)}>
              <Trash2 /> Remove
            </Button>
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
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Remove this notice?" confirmLabel="Remove" onConfirm={remove} />
    </div>
  );
}
