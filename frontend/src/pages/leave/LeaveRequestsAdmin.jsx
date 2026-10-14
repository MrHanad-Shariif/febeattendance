import { useEffect, useState } from "react";
import { Check, FileText, MessageSquareMore, X } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Alert } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext.jsx";
import { dateRange, RequestBadge, RequestHistory } from "./shared.jsx";

const ALL = "all";

function ReviewDialog({ id, onClose, onDecided }) {
  const { user, can } = useAuth();
  const [req, setReq] = useState(null);
  const [comment, setComment] = useState("");
  const [justified, setJustified] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setReq(null);
    setComment("");
    setError("");
    client.get(`/admin/leave-requests/${id}`).then((r) => setReq(r.data)).catch((err) => setError(apiErrorMessage(err)));
  }, [id]);

  async function decide(decision) {
    setBusy(decision);
    setError("");
    try {
      await client.post(`/admin/leave-requests/${id}/decision`, { decision, comment, justified });
      toast.success({ approve: "Approved: the absence is recorded and students told", reject: "Request rejected", more_info: "Asked for more information" }[decision]);
      onDecided();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function openDocument() {
    try {
      const res = await client.get(`/leave-requests/${id}/document`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank", "noopener");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const open = req && ["pending", "more_info"].includes(req.status);
  const own = req && user && req.lecturer_id === user.id;
  const canDecide = can("lecturer_absences:add") && !own;

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Leave request{req ? `: ${req.lecturer_name}` : ""}</DialogTitle>
          <DialogDescription>Approving records the absence, exempts the affected sessions and tells the students their classes are cancelled.</DialogDescription>
        </DialogHeader>
        {!req && !error && <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>}
        {req && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Type:</span> {req.reason_label} ({req.kind_label})
              </p>
              <p>
                <span className="text-muted-foreground">Dates:</span> {dateRange(req.start_date, req.end_date)} · {req.days} day{req.days === 1 ? "" : "s"}
              </p>
              <p>
                <span className="text-muted-foreground">Status:</span> <RequestBadge row={req} />
              </p>
              <p>
                <span className="text-muted-foreground">Sent:</span> {new Date(req.created_at).toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Reason / remarks</p>
              <p className="mt-1 whitespace-pre-wrap">{req.remarks}</p>
            </div>
            {req.document_name && (
              <Button variant="outline" size="sm" onClick={openDocument}>
                <FileText /> {req.document_name}
              </Button>
            )}
            <div>
              <p className="font-medium">
                Affected sessions: {req.affected.total_sessions}
                {req.affected.classes.length > 0 && <span className="font-normal text-muted-foreground"> · {req.affected.classes.map((c) => `${c.course_name} (${c.batch}) ×${c.sessions}`).join(", ")}</span>}
              </p>
              {req.affected.total_sessions === 0 && <p className="text-muted-foreground">No timetabled classes fall in these dates.</p>}
            </div>
            {req.conflicts.length > 0 && (
              <Alert>
                Already recorded: {req.conflicts.map((c) => `${c.reason_label} from ${c.start_date}`).join(", ")}. Approving would conflict; edit that absence instead.
              </Alert>
            )}
            <RequestHistory events={req.events} />
            {open && canDecide && (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <Label>Comment (required to reject or ask for more information)</Label>
                  <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>
                <label className="flex items-center gap-2">
                  <Checkbox checked={justified} onCheckedChange={(v) => setJustified(v === true)} /> Record as a justified absence
                </label>
              </div>
            )}
            {open && own && <Alert variant="success">This is your own request: another member of the Academic Office must decide it.</Alert>}
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        {open && canDecide && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => decide("more_info")} disabled={!!busy || !comment.trim()}>
              <MessageSquareMore /> Ask for more information
            </Button>
            <Button variant="destructive" onClick={() => decide("reject")} disabled={!!busy || !comment.trim()}>
              <X /> Reject
            </Button>
            <Button onClick={() => decide("approve")} disabled={!!busy || req.conflicts.length > 0}>
              <Check /> {busy === "approve" ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function LeaveRequestsAdmin({ initialId, onChanged }) {
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState({ rows: [], counts: {}, statuses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(initialId || null);

  function load() {
    setLoading(true);
    client
      .get("/admin/leave-requests", { params: status === ALL ? {} : { status } })
      .then((r) => setData(r.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All requests</SelectItem>
            {data.statuses.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label} ({data.counts[s.value] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Pending requests are not approved leave and cancel no classes.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!loading && data.rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No requests here.</CardContent>
        </Card>
      )}
      <div className="space-y-2">
        {data.rows.map((r) => (
          <button key={r.id} type="button" onClick={() => setViewing(r.id)} className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {r.lecturer_name} · {r.reason_label}
                  {r.kind === "same_day" && (
                    <Badge variant="danger" className="ml-2">
                      Same day
                    </Badge>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {dateRange(r.start_date, r.end_date)} · {r.days} day{r.days === 1 ? "" : "s"} · sent {new Date(r.created_at).toLocaleDateString()}
                </p>
                <p className="line-clamp-2 text-sm">{r.remarks}</p>
              </div>
              <RequestBadge row={r} />
            </div>
          </button>
        ))}
      </div>
      <ReviewDialog
        id={viewing}
        onClose={() => setViewing(null)}
        onDecided={() => {
          setViewing(null);
          load();
          onChanged?.();
        }}
      />
    </div>
  );
}
