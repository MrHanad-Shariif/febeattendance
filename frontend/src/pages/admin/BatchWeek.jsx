import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { OptionSelect, useApi } from "@/components/committees/shared";
import { Alert } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function isoDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

function niceDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** One batch's classes for a teaching week (Saturday–Friday) with real dates. */
export default function BatchWeek({ batches }) {
  const [batch, setBatch] = useState("");
  const [day, setDay] = useState(isoDate(new Date()));
  const { data, loading, error } = useApi(batch ? `/admin/timetable/batch-week?batch=${encodeURIComponent(batch)}&date=${day}` : null, null);

  useEffect(() => {
    if (!batch && batches.length) setBatch(batches.find((b) => !b.combined)?.code || batches[0].code);
  }, [batches, batch]);

  const rows = (data?.days || []).flatMap((d) =>
    d.classes.length ? d.classes.map((c, i) => ({ ...c, ...d, first: i === 0, span: d.classes.length })) : [{ ...d, empty: true, first: true, span: 1 }]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Batch</p>
          <OptionSelect value={batch} onChange={setBatch} options={batches.map((b) => ({ value: b.code, label: b.code }))} className="w-48" placeholder="Choose a batch" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Week of</p>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" aria-label="Previous week" onClick={() => setDay(shiftDays(day, -7))}>
              <ChevronLeft />
            </Button>
            <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" />
            <Button size="icon" variant="outline" aria-label="Next week" onClick={() => setDay(shiftDays(day, 7))}>
              <ChevronRight />
            </Button>
          </div>
        </div>
        <Button variant="outline" onClick={() => window.print()} disabled={!data}>
          <Printer /> Print
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}
      {!batch ? (
        <p className="text-sm text-muted-foreground">Add batches (Batches tab) or upload a timetable to see a batch's week.</p>
      ) : loading && !data ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        data && (
          <Card className="overflow-x-auto">
            <div className="border-b px-4 py-3">
              <p className="font-semibold">{data.batch} timetable</p>
              <p className="text-sm text-muted-foreground">
                {niceDate(data.week_start)} – {niceDate(data.week_end)}
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Lecturer</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Room</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.date}-${i}`} className={r.first ? "border-t-2" : ""}>
                    {r.first && (
                      <>
                        <TableCell rowSpan={r.span} className="whitespace-nowrap align-top font-medium">
                          {niceDate(r.date)}
                        </TableCell>
                        <TableCell rowSpan={r.span} className="align-top">
                          {r.day}
                        </TableCell>
                      </>
                    )}
                    {r.empty ? (
                      <TableCell colSpan={4} className="text-muted-foreground">
                        {r.no_class ? <Badge variant="warning">No classes (holiday / exams)</Badge> : "No classes"}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {r.start_time}
                          {r.end_time ? ` – ${r.end_time}` : ""}
                        </TableCell>
                        <TableCell>{r.lecturer_name || <Badge variant="warning">Not assigned</Badge>}</TableCell>
                        <TableCell>
                          {r.course_name}
                          {r.no_class && <Badge variant="warning" className="ml-2">No class this day</Badge>}
                          {r.batch !== data.batch && <span className="ml-2 text-xs text-muted-foreground">with {r.batch}</span>}
                        </TableCell>
                        <TableCell>{r.room || "—"}</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )
      )}
    </div>
  );
}
