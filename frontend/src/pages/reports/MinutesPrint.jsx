import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { FebeDocumentFooter, FebeDocumentHeader, useLightTheme } from "@/components/committees/FebeDocumentHeader.jsx";
import { DocumentActions, useApi } from "@/components/committees/shared";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/committees";

/** FEBE-branded record of published minutes, for viewing, printing and
 * "Save as PDF". The official document itself is attached (View/Download). */
export default function MinutesPrint() {
  useLightTheme();
  const { id } = useParams();
  const { data: m, error } = useApi(`/minutes/${id}`);
  const meeting = m?.meeting;

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-white px-8 py-8 text-slate-900">
      <div className="mb-6 flex flex-wrap items-center justify-end gap-2 print:hidden">
        {m && <DocumentActions url={m.url} fileName={m.file_name} showName={false} />}
        <Button onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {m && (
        <article>
          <FebeDocumentHeader
            title="Minutes of Meeting"
            subtitle={m.title}
            meta={[
              { label: "Committee / unit", value: m.committee_name },
              { label: "Meeting date", value: formatDate(m.meeting_date) },
              { label: "Release date", value: formatDateTime(m.published_at) },
              { label: "Time", value: meeting?.start_time ? `${meeting.start_time}${meeting.end_time ? ` – ${meeting.end_time}` : ""}` : null },
              { label: "Location", value: meeting?.location },
              { label: "Published by", value: m.uploaded_by_name },
            ]}
          />
          {meeting?.agenda && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-emerald-800">Agenda</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{meeting.agenda}</p>
            </section>
          )}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-emerald-800">Summary</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {m.summary || "The full minutes are in the attached official document."}
            </p>
          </section>
          <section className="mt-6 rounded border border-slate-300 p-3 text-sm">
            Official document: <strong>{m.file_name}</strong>
          </section>
          <FebeDocumentFooter />
        </article>
      )}
    </div>
  );
}
