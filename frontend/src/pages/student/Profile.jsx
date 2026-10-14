import { useState } from "react";
import { History, Pencil, Save, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const ORDER = ["name", "student_id_number", "email", "phone", "department", "program", "batch", "study_semester"];
const STATUS_VARIANTS = { pending: "warning", awaiting_confirmation: "info", approved: "success", rejected: "danger", cancelled: "secondary" };

function ValueInput({ field, value, onChange, data }) {
  const choices = field === "department" ? data.departments : field === "batch" ? data.batches : field === "study_semester" ? Array.from({ length: 12 }, (_, i) => String(i + 1)) : null;
  if (choices) {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Choose..." />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c} value={c}>
              {field === "study_semester" ? `Semester ${c}` : c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return <Input type={field === "email" ? "email" : "text"} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
}

function RequestDialog({ field, data, onClose, onSent }) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = data.labels[field];

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await client.post("/student/profile/requests", { field, new_value: value, reason });
      toast.success("Request sent to the faculty office");
      onSent();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Change {label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              An administrator checks and approves this change. Current value: <strong>{data.profile[field] || "—"}</strong>
              {field === "email" && ". After approval, confirm the new address from its inbox; until then keep signing in with your current email."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New {label.toLowerCase()}</Label>
            <ValueInput field={field} value={value} onChange={setValue} data={data} />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea rows={2} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. My name was misspelt at registration" />
          </div>
          {error && <Alert>{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !value || reason.trim().length < 5}>
              <Send /> Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function StudentProfile() {
  const { data, loading, error, reload } = useApi("/student/profile", null);
  const [editing, setEditing] = useState({});
  const [requesting, setRequesting] = useState(null);
  const [saving, setSaving] = useState(false);

  async function saveDirect() {
    setSaving(true);
    try {
      await client.put("/student/profile", editing);
      toast.success("Profile saved");
      setEditing({});
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function cancel(r) {
    try {
      await client.post(`/student/profile/requests/${r.id}/cancel`);
      toast.success("Request cancelled");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  if (error) return <Alert>{error}</Alert>;
  const open = new Set(data.requests.filter((r) => ["pending", "awaiting_confirmation"].includes(r.status)).map((r) => r.field));
  const dirty = Object.keys(editing).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" description="Your student record. Some details you change yourself; others are changed by the faculty office on request." />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Profile settings</CardTitle>
          <CardDescription>{data.profile.faculty}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {ORDER.map((field) => {
            const direct = data.self_edit.includes(field);
            const byRequest = data.approval.includes(field);
            const value = data.profile[field];
            return (
              <div key={field} className="grid items-center gap-2 py-3 sm:grid-cols-3">
                <p className="text-sm text-muted-foreground">{data.labels[field]}</p>
                <div className="sm:col-span-1">
                  {direct && field in editing ? (
                    <ValueInput field={field} value={editing[field]} onChange={(v) => setEditing((e) => ({ ...e, [field]: v }))} data={data} />
                  ) : (
                    <p className="font-medium">{field === "study_semester" && value ? `Semester ${value}` : value || "—"}</p>
                  )}
                </div>
                <div className="flex justify-start gap-2 sm:justify-end">
                  {direct && !(field in editing) && (
                    <Button size="sm" variant="outline" onClick={() => setEditing((e) => ({ ...e, [field]: value || "" }))}>
                      <Pencil /> Edit
                    </Button>
                  )}
                  {byRequest &&
                    (open.has(field) ? (
                      <Badge variant="warning">Change requested</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setRequesting(field)}>
                        Request change
                      </Button>
                    ))}
                  {!direct && !byRequest && <span className="text-xs text-muted-foreground">Contact the faculty office</span>}
                </div>
              </div>
            );
          })}
        </CardContent>
        {dirty && (
          <div className="flex justify-end gap-2 border-t p-4">
            <Button variant="outline" onClick={() => setEditing({})}>
              Cancel
            </Button>
            <Button onClick={saveDirect} disabled={saving}>
              <Save /> {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">My change requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.requests.length === 0 && <p className="text-sm text-muted-foreground">No requests.</p>}
          {data.requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {r.field_label}: {r.old_value || "—"} → {r.new_value}
                </p>
                <p className="text-muted-foreground">
                  {r.reason} · sent {new Date(r.created_at).toLocaleDateString()}
                </p>
                {r.review_comment && (
                  <p>
                    {r.reviewer_name}: {r.review_comment}
                  </p>
                )}
                {r.status === "awaiting_confirmation" && <p className="text-info">Open the link we emailed to {r.new_value} to finish.</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANTS[r.status]}>{r.status_label}</Badge>
                {["pending", "awaiting_confirmation"].includes(r.status) && (
                  <Button size="sm" variant="ghost" onClick={() => cancel(r)}>
                    <Undo2 /> Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {data.history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Change history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.history.map((h) => (
              <p key={h.id}>
                <span className="text-muted-foreground">{new Date(h.changed_at).toLocaleString()}</span> · {h.field_label}: {h.old_value || "—"} → {h.new_value || "—"}{" "}
                <span className="text-muted-foreground">({h.source === "self" ? "by you" : `by ${h.changed_by_name}`})</span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {requesting && (
        <RequestDialog
          field={requesting}
          data={data}
          onClose={() => setRequesting(null)}
          onSent={() => {
            setRequesting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
