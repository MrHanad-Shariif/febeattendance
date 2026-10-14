import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Alert } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const VARIANTS = { pending: "warning", awaiting_confirmation: "info", approved: "success", rejected: "danger", cancelled: "secondary" };

/** Students' profile change requests: approve, or reject with a reason. */
export default function ProfileRequestsAdmin({ canEdit, onChanged }) {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [comments, setComments] = useState({});

  function load() {
    client
      .get("/admin/profile-requests", { params: status === "all" ? {} : { status } })
      .then((r) => setRows(r.data.rows))
      .catch((err) => setError(apiErrorMessage(err)));
  }
  useEffect(load, [status]);

  async function decide(r, decision) {
    try {
      await client.post(`/admin/profile-requests/${r.id}/decision`, { decision, comment: comments[r.id] || "" });
      toast.success(decision === "approve" ? (r.field === "email" ? "Approved: the student must confirm the new address" : "Approved and applied") : "Rejected");
      load();
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="awaiting_confirmation">Waiting for email confirmation</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
      {error && <Alert>{error}</Alert>}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No requests here.</p>}
      {rows.map((r) => (
        <Card key={r.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">
                {r.student_name} <span className="text-muted-foreground">({r.student_id_number || "no ID"}, {r.batch || "no class"})</span>
              </p>
              <p>
                {r.field_label}: <span className="text-muted-foreground line-through">{r.old_value || "—"}</span> → <strong>{r.new_value}</strong>
              </p>
              <p className="text-muted-foreground">Reason: {r.reason}</p>
              {r.review_comment && <p>Decision note: {r.review_comment}</p>}
            </div>
            <Badge variant={VARIANTS[r.status]}>{r.status_label}</Badge>
          </div>
          {r.status === "pending" && canEdit && (
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-[200px] flex-1"
                placeholder="Note to the student (required to reject)"
                value={comments[r.id] || ""}
                onChange={(e) => setComments((c) => ({ ...c, [r.id]: e.target.value }))}
              />
              <Button size="sm" variant="destructive" onClick={() => decide(r, "reject")} disabled={!(comments[r.id] || "").trim()}>
                <X /> Reject
              </Button>
              <Button size="sm" onClick={() => decide(r, "approve")}>
                <Check /> Approve
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
