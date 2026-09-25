import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Renders the API's report shape: {summary: [{label,value}], columns: [{key,label}], rows}. */
export function ReportView({ report, print = false }) {
  return (
    <div className="space-y-4">
      {report.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {report.summary.map((s) => (
            <div key={s.label} className={print ? "rounded border border-slate-300 p-2" : "rounded-lg border bg-card p-3"}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      )}
      <div className={print ? "" : "overflow-x-auto rounded-xl border bg-card"}>
        <Table className={print ? "text-xs" : undefined}>
          <TableHeader className={print ? undefined : "bg-muted/40"}>
            <TableRow>
              {report.columns.map((c) => (
                <TableHead key={c.key}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row, i) => (
              <TableRow key={i} className="break-inside-avoid">
                {report.columns.map((c) => (
                  <TableCell key={c.key}>{row[c.key] ?? "—"}</TableCell>
                ))}
              </TableRow>
            ))}
            {report.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={report.columns.length} className="h-24 text-center text-muted-foreground">
                  No records for this report.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
