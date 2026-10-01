import { useMemo, useState } from "react";
import { Check, FileSpreadsheet, X } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, OptionSelect, useApi } from "@/components/committees/shared";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext.jsx";
import { downloadFromApi, formatDateTime } from "@/lib/committees";
import { RequestStatusBadge, STATUS_OPTIONS, formatDay } from "./shared";

const EXPORT_OPTIONS = [{ value: "all", label: "All requests" }, ...STATUS_OPTIONS.map((o) => ({ ...o, label: `${o.label} only` }))];

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || "—"}</dd>
    </div>
  );
}

function ReviewDialog({ request, canDecide, onClose, onDecided }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  async function decide(decision) {
    setSaving(decision);
    setError("");
    try {
      const res = await client.post(`/special-exams/${request.id}/decision`, { decision, note });
      toast.success(`Request ${decision}. The student has been notified.`);
      onDecided(res.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving("");
    }
  }

  const decided = request.status !== "pending";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Special exam request</DialogTitle>
          <DialogDescription>Sent {formatDateTime(request.created_at)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3">
          <Detail label="Student">{request.full_name}</Detail>
          <Detail label="ID number">{request.id_number}</Detail>
          <Detail label="Batch">{request.batch}</Detail>
          <Detail label="Course">{request.course_name}</Detail>
          <Detail label="Exam date">{formatDay(request.exam_date)}</Detail>
          <Detail label="Shift">Shift {request.shift}</Detail>
          <Detail label="Phone">{request.phone}</Detail>
          <Detail label="Email">{request.student_email}</Detail>
          <div className="col-span-2">
            <Detail label="Reason">
              <span className="whitespace-pre-line">{request.reason}</span>
            </Detail>
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-sm">
            <RequestStatusBadge status={request.status} />
            {decided && (
              <span className="text-muted-foreground">
                by {request.decided_by_name || "—"} on {formatDateTime(request.decided_at)}
              </span>
            )}
          </div>
          {request.decision_note && (
            <div className="col-span-2">
              <Detail label="Note sent with the decision">{request.decision_note}</Detail>
            </div>
          )}
        </dl>

        {canDecide && (
          <div className="space-y-3 border-t pt-4">
            {decided && (
              <p className="text-xs text-muted-foreground">Changing the decision emails the student again.</p>
            )}
            <Field label="Reason for the decision (optional)" htmlFor="se-note" hint="Included in the student's email.">
              <Textarea id="se-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {error && <Alert>{error}</Alert>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {canDecide ? (
            <>
              <Button variant="outline" onClick={() => decide("declined")} disabled={!!saving || request.status === "declined"}>
                <X /> {saving === "declined" ? "Declining..." : "Decline"}
              </Button>
              <Button onClick={() => decide("approved")} disabled={!!saving || request.status === "approved"}>
                <Check /> {saving === "approved" ? "Approving..." : "Approve"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SpecialExamReview() {
  const { user } = useAuth();
  const canDecide = !!user?.capabilities?.can_decide_special_exams;
  const { data, setData, loading, error } = useApi("/special-exams", []);
  const [selected, setSelected] = useState(null);
  const [exportStatus, setExportStatus] = useState("all");
  const [downloading, setDownloading] = useState(false);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, declined: 0 };
    (data || []).forEach((r) => (c[r.status] += 1));
    return c;
  }, [data]);

  async function download() {
    setDownloading(true);
    try {
      const query = exportStatus === "all" ? "" : `?status=${exportStatus}`;
      const today = new Date().toISOString().slice(0, 10);
      await downloadFromApi(`/special-exams/export.xlsx${query}`, `special-exam-requests-${exportStatus}-${today}.xlsx`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sent" />,
        meta: { label: "Sent" },
        cell: ({ row }) => formatDateTime(row.original.created_at),
      },
      {
        accessorKey: "full_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Student" />,
        meta: { label: "Student" },
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.full_name}</p>
            <p className="text-xs text-muted-foreground">{row.original.id_number}</p>
          </div>
        ),
      },
      { accessorKey: "id_number", header: "ID number", meta: { label: "ID number" } },
      {
        accessorKey: "batch",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        meta: { label: "Batch" },
        filterFn: "equalsString",
      },
      {
        accessorKey: "course_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Course" />,
        meta: { label: "Course" },
      },
      {
        accessorKey: "exam_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Exam date" />,
        meta: { label: "Exam date" },
        cell: ({ row }) => formatDay(row.original.exam_date),
      },
      {
        accessorKey: "shift",
        header: "Shift",
        meta: { label: "Shift" },
        filterFn: (row, id, value) => String(row.getValue(id)) === String(value),
      },
      { accessorKey: "phone", header: "Phone", meta: { label: "Phone" } },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        meta: { label: "Status" },
        filterFn: "equalsString",
        cell: ({ row }) => <RequestStatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-24 text-right" },
        cell: ({ row }) => (
          <Button size="sm" variant={row.original.status === "pending" && canDecide ? "default" : "outline"}>
            {row.original.status === "pending" && canDecide ? "Review" : "View"}
          </Button>
        ),
      },
    ],
    [canDecide]
  );

  const batchOptions = [...new Set((data || []).map((r) => r.batch))].sort().map((b) => ({ value: b, label: b }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Special exam requests"
        description={`${counts.pending} pending · ${counts.approved} approved · ${counts.declined} declined`}
        actions={
          <>
            <OptionSelect value={exportStatus} onChange={(v) => setExportStatus(v || "all")} options={EXPORT_OPTIONS} className="w-40" />
            <Button onClick={download} disabled={downloading}>
              <FileSpreadsheet /> {downloading ? "Preparing..." : "Download Excel"}
            </Button>
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      <DataTable
        columns={columns}
        data={data || []}
        loading={loading}
        getRowId={(r) => String(r.id)}
        searchPlaceholder="Search name, ID, course or phone..."
        filters={[
          { columnId: "status", label: "Status", options: STATUS_OPTIONS },
          { columnId: "batch", label: "Batch", options: batchOptions },
          { columnId: "shift", label: "Shift", options: [{ value: "1", label: "Shift 1" }, { value: "2", label: "Shift 2" }] },
        ]}
        initialSorting={[{ id: "created_at", desc: true }]}
        initialVisibility={{ id_number: false, phone: false }}
        onRowClick={(row) => setSelected(row)}
        emptyText="No special exam requests yet."
      />
      {selected && (
        <ReviewDialog
          request={selected}
          canDecide={canDecide}
          onClose={() => setSelected(null)}
          onDecided={(updated) => {
            setData((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
