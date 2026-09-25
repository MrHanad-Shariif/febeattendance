import { useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { FebeDocumentFooter, FebeDocumentHeader, useLightTheme } from "@/components/committees/FebeDocumentHeader.jsx";
import { ReportView } from "@/components/committees/ReportView.jsx";
import { useApi } from "@/components/committees/shared";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/committees";

/** FEBE-branded printable report: /print/report?type=...&committee_id=... */
export default function ReportPrint() {
  useLightTheme();
  const [params] = useSearchParams();
  const type = params.get("type");
  const query = new URLSearchParams(params);
  query.delete("type");
  const { data: report, error } = useApi(type ? `/reports/${type}?${query}` : null);

  return (
    <div className="mx-auto min-h-screen max-w-5xl bg-white px-8 py-8 text-slate-900">
      <div className="mb-6 flex justify-end print:hidden">
        <Button onClick={() => window.print()} disabled={!report}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {report && (
        <article className="space-y-6">
          <FebeDocumentHeader
            title={report.title}
            meta={[
              { label: "Committee / unit", value: report.scope },
              { label: "Date generated", value: formatDateTime(report.generated_at) },
              { label: "Records", value: String(report.rows.length) },
            ]}
          />
          <ReportView report={report} print />
          <FebeDocumentFooter />
        </article>
      )}
    </div>
  );
}
