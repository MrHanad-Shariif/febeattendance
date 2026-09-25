import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, FileBarChart, Printer } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/api/client";
import { ReportView } from "@/components/committees/ReportView.jsx";
import { Field, OptionSelect, useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadFromApi, formatDateTime } from "@/lib/committees";

const NEEDS = {
  committee_tasks: ["committee"],
  member_tasks: ["member", "committee"],
  overdue: ["committee"],
  completed: ["committee", "dates"],
  committee_activity: ["committee"],
  faculty_overview: [],
};

export default function CommitteeReports() {
  const [params, setParams] = useSearchParams();
  const options = useApi("/reports", null);
  const type = params.get("type") || "";
  const [form, setForm] = useState({
    committee_id: params.get("committee_id") || "",
    member_id: params.get("member_id") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
  });

  useEffect(() => {
    if (!type && options.data?.types?.length) setParams({ type: options.data.types[0].value }, { replace: true });
  }, [type, options.data, setParams]);

  const needs = NEEDS[type] || [];
  const query = new URLSearchParams(
    Object.entries({ ...form }).filter(([k, v]) => v && ((k === "committee_id" && needs.includes("committee")) || (k === "member_id" && needs.includes("member")) || ((k === "from" || k === "to") && needs.includes("dates"))))
  ).toString();
  const ready = type && !(type === "committee_tasks" && !form.committee_id) && !(type === "member_tasks" && !form.member_id);
  const report = useApi(ready ? `/reports/${type}?${query}` : null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function downloadCsv() {
    try {
      await downloadFromApi(`/reports/${type}?${query}&format=csv`, `${type}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Committee task and activity reports with FEBE branding, for printing, saving as PDF or downloading."
        actions={
          report.data && (
            <>
              <Button variant="outline" onClick={downloadCsv}>
                <Download /> Download CSV
              </Button>
              <Button onClick={() => window.open(`/print/report?type=${type}&${query}`, "_blank")}>
                <Printer /> Print / PDF
              </Button>
            </>
          )
        }
      />
      {options.error && <Alert>{options.error}</Alert>}
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Report" htmlFor="r-type">
            <OptionSelect id="r-type" value={type} onChange={(v) => setParams({ type: v })} options={options.data?.types || []} />
          </Field>
          {needs.includes("member") && (
            <Field label="Member" htmlFor="r-member">
              <OptionSelect
                id="r-member"
                value={form.member_id}
                onChange={set("member_id")}
                placeholder="Choose a member"
                options={(options.data?.members || []).map((m) => ({ value: m.id, label: m.name }))}
              />
            </Field>
          )}
          {needs.includes("committee") && (
            <Field label="Committee" htmlFor="r-committee">
              <OptionSelect
                id="r-committee"
                value={form.committee_id}
                onChange={set("committee_id")}
                placeholder="Choose a committee"
                anyLabel={type === "committee_tasks" ? undefined : "All my committees"}
                options={(options.data?.committees || []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          )}
          {needs.includes("dates") && (
            <Field label="Completed between" htmlFor="r-from">
              <div className="flex gap-2">
                <Input id="r-from" type="date" value={form.from} onChange={(e) => set("from")(e.target.value)} />
                <Input type="date" aria-label="to" value={form.to} onChange={(e) => set("to")(e.target.value)} />
              </div>
            </Field>
          )}
        </CardContent>
      </Card>

      {!ready ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <FileBarChart className="h-8 w-8 opacity-50" />
          Choose what to report on.
        </Card>
      ) : report.error ? (
        <Alert>{report.error}</Alert>
      ) : !report.data || report.loading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{report.data.title}</strong> · {report.data.scope} · generated{" "}
            {formatDateTime(report.data.generated_at)}
          </p>
          <ReportView report={report.data} />
        </div>
      )}
    </div>
  );
}
