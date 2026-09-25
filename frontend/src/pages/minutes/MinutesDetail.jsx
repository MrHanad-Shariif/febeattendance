import { Link, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { DocumentActions, InfoRow, useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/committees";

export default function MinutesDetail() {
  const { id } = useParams();
  const { data: m, error } = useApi(`/minutes/${id}`);
  if (error) return <Alert>{error}</Alert>;
  if (!m) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.title}
        description={`${m.committee_name} · meeting of ${formatDate(m.meeting_date)}`}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/print/minutes/${m.id}`} target="_blank">
              <Printer /> Printable version
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Official minutes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {m.summary && <p className="whitespace-pre-wrap text-sm">{m.summary}</p>}
            <DocumentActions url={m.url} fileName={m.file_name} />
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardContent className="pt-6">
            <dl className="divide-y">
              <InfoRow label="Committee">
                <Link className="text-primary hover:underline" to={`/committees/${m.committee_id}`}>
                  {m.committee_name}
                </Link>
              </InfoRow>
              <InfoRow label="Unit type">{m.unit_label}</InfoRow>
              <InfoRow label="Meeting date">{formatDate(m.meeting_date)}</InfoRow>
              <InfoRow label="Released">{formatDateTime(m.published_at)}</InfoRow>
              <InfoRow label="Published by">{m.uploaded_by_name}</InfoRow>
              <InfoRow label="Visibility">{m.visibility === "faculty" ? "Faculty-wide" : "Committee members"}</InfoRow>
              {m.meeting && (
                <InfoRow label="Meeting">
                  <Link className="text-primary hover:underline" to={`/meetings/${m.meeting.id}`}>
                    {m.meeting.title}
                  </Link>
                </InfoRow>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
