import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Ban, CalendarDays, Clock, FileText, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import { MeetingFormDialog } from "@/components/committees/MeetingFormDialog.jsx";
import { DocumentActions, InfoRow, MeetingStatusBadge, useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/committees";

export default function MeetingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: m, error, reload } = useApi(`/meetings/${id}`);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (error) return <Alert>{error}</Alert>;
  if (!m) return <Skeleton className="h-64 w-full" />;

  const canPublish = user?.role === "admin" || user?.capabilities?.is_admin_team;

  async function cancelMeeting() {
    try {
      await client.put(`/meetings/${m.id}`, { status: "cancelled" });
      toast.success("Meeting cancelled. Members have been notified.");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.title}
        description={
          <Link to={`/committees/${m.committee_id}`} className="text-primary hover:underline">
            {m.committee_name}
          </Link>
        }
        actions={
          <>
            {m.minutes_id && (
              <Button asChild>
                <Link to={`/meeting-minutes/${m.minutes_id}`}>
                  <FileText /> View minutes
                </Link>
              </Button>
            )}
            {!m.minutes_id && canPublish && m.status !== "cancelled" && (
              <Button asChild>
                <Link to={`/meeting-minutes/publish?meeting_id=${m.id}`}>
                  <FileText /> Upload minutes
                </Link>
              </Button>
            )}
            {m.can_edit && m.status === "scheduled" && (
              <>
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil /> Edit
                </Button>
                <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>
                  <Ban /> Cancel meeting
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Agenda</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm">{m.agenda || <span className="text-muted-foreground">No agenda text.</span>}</p>
            {m.agenda_url && <DocumentActions url={m.agenda_url} fileName={m.agenda_file_name} />}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <InfoRow label="Status">
                <MeetingStatusBadge status={m.status} />
              </InfoRow>
              <InfoRow label={<span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Date</span>}>{formatDate(m.date)}</InfoRow>
              <InfoRow label={<span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Time</span>}>
                {m.start_time ? `${m.start_time}${m.end_time ? ` – ${m.end_time}` : ""}` : null}
              </InfoRow>
              <InfoRow label={<span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Location</span>}>{m.location}</InfoRow>
              <InfoRow label="Type">{m.meeting_type}</InfoRow>
              <InfoRow label="Scheduled by">{m.created_by_name}</InfoRow>
            </dl>
          </CardContent>
        </Card>
      </div>
      <MeetingFormDialog open={editOpen} onOpenChange={setEditOpen} meeting={m} onSaved={reload} />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this meeting?"
        description="All committee members will be notified that the meeting is cancelled."
        confirmLabel="Cancel meeting"
        onConfirm={cancelMeeting}
      />
    </div>
  );
}
