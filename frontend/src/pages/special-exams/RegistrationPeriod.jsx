import { useState } from "react";
import { CalendarClock, Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, useApi } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, toLocalInput } from "@/lib/committees";
import { PeriodBadge } from "./shared";

function localInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function defaults() {
  const end = new Date(Date.now() + 5 * 86400000);
  end.setHours(23, 59, 0, 0);
  return { title: "", opens_at: localInput(new Date()), closes_at: localInput(end) };
}

function PeriodDialog({ period, onClose, onSaved }) {
  const [form, setForm] = useState(
    period ? { title: period.title || "", opens_at: toLocalInput(period.opens_at), closes_at: toLocalInput(period.closes_at) } : defaults()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function endAfter(days) {
    const start = form.opens_at ? new Date(form.opens_at) : new Date();
    const end = new Date(start.getTime() + days * 86400000);
    end.setHours(23, 59, 0, 0);
    setForm((f) => ({ ...f, closes_at: localInput(end) }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = period ? await client.put(`/special-exams/period/${period.id}`, form) : await client.post("/special-exams/period", form);
      toast.success(period ? "Registration period updated" : "Registration period set");
      onSaved(res.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{period ? "Change registration period" : "Open special exam registration"}</DialogTitle>
            <DialogDescription>Students can register and send their reason only between these two times.</DialogDescription>
          </DialogHeader>
          <Field label="Title (optional)" htmlFor="sp-title" hint="For example: Midterm exams, October 2026.">
            <Input id="sp-title" value={form.title} onChange={set("title")} maxLength={200} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opens" htmlFor="sp-open">
              <Input id="sp-open" type="datetime-local" value={form.opens_at} onChange={set("opens_at")} required />
            </Field>
            <Field label="Closes" htmlFor="sp-close">
              <Input id="sp-close" type="datetime-local" value={form.closes_at} onChange={set("closes_at")} required />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Close after
            {[3, 5, 7].map((d) => (
              <Button key={d} type="button" size="sm" variant="outline" className="h-7" onClick={() => endAfter(d)}>
                {d} days
              </Button>
            ))}
          </div>
          {error && <Alert>{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The registration window: special exams are closed unless the Administration Team opens a period. */
export default function RegistrationPeriod({ canEdit }) {
  const { data, loading, error, reload } = useApi("/special-exams/period", null);
  const [editing, setEditing] = useState(null); // "new" | period
  const [closing, setClosing] = useState(false);

  if (loading && !data) return <Skeleton className="h-28 w-full" />;
  const current = data?.current;
  const active = current && current.status !== "closed";

  async function closeNow() {
    try {
      await client.post(`/special-exams/period/${current.id}/close`);
      toast.success("Registration closed");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" /> Registration period
            <PeriodBadge period={active ? current : null} />
          </CardTitle>
          <CardDescription>
            {active
              ? `${current.title ? `${current.title}: ` : ""}${formatDateTime(current.opens_at)} – ${formatDateTime(current.closes_at)}`
              : "Registration is closed. Students can't register until you open a period."}
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {active ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(current)}>
                  <Pencil /> Change dates
                </Button>
                <Button size="sm" variant="outline" onClick={() => setClosing(true)}>
                  <Lock /> Close now
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus /> Open registration
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      {(error || (data?.history || []).length > 0) && (
        <CardContent className="space-y-2">
          {error && <Alert>{error}</Alert>}
          {(data?.history || []).length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Past and planned periods</summary>
              <ul className="mt-2 space-y-1">
                {data.history.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <PeriodBadge period={p} />
                    <span>
                      {p.title ? `${p.title}: ` : ""}
                      {formatDateTime(p.opens_at)} – {formatDateTime(p.closes_at)}
                    </span>
                    <span className="text-xs text-muted-foreground">{p.request_count} request(s)</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      )}
      {editing && (
        <PeriodDialog
          period={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {closing && (
        <ConfirmDialog
          open
          title="Close registration now?"
          description="Students will no longer be able to register for a special exam."
          confirmLabel="Close registration"
          onConfirm={closeNow}
          onOpenChange={(open) => !open && setClosing(false)}
        />
      )}
    </Card>
  );
}
