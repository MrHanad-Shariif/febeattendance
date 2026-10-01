import { useEffect, useState } from "react";
import { CalendarX2, CheckCircle2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, OptionSelect, useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/committees";
import { RequestStatusBadge, formatDay, todayIso } from "./shared";

const SHIFT_OPTIONS = [
  { value: "1", label: "Shift 1" },
  { value: "2", label: "Shift 2" },
];

const EMPTY = { full_name: "", batch: "", course_name: "", reason: "", exam_date: "", shift: "", phone: "", id_number: "" };

function RequestForm({ onCreated }) {
  const { data: options, loading } = useApi("/special-exams/options", null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!options) return;
    const d = options.defaults || {};
    const batch = d.batch && options.batches[d.batch] ? d.batch : "";
    setForm((f) => ({ ...f, full_name: d.full_name || "", id_number: d.id_number || "", batch }));
  }, [options]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const batches = Object.keys(options?.batches || {});
  const courses = (options?.batches || {})[form.batch] || [];

  async function submit(e) {
    e.preventDefault();
    setError("");
    const missing = Object.keys(EMPTY).filter((k) => !String(form[k]).trim());
    if (missing.length) {
      setError("Please fill in every field.");
      return;
    }
    setSaving(true);
    try {
      await client.post("/special-exams", form);
      toast.success("Request sent. You'll get an email when it's decided.");
      setForm((f) => ({ ...EMPTY, full_name: f.full_name, id_number: f.id_number, batch: f.batch, phone: f.phone }));
      onCreated();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Register for a special exam</CardTitle>
        <CardDescription>All fields are required. The Administration Team will review your request.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="se-name">
            <Input id="se-name" value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} maxLength={200} />
          </Field>
          <Field label="ID number" htmlFor="se-id">
            <Input id="se-id" value={form.id_number} onChange={(e) => set("id_number")(e.target.value)} maxLength={50} />
          </Field>
          <Field label="Batch" htmlFor="se-batch">
            <OptionSelect
              id="se-batch"
              value={form.batch}
              onChange={(v) => setForm((f) => ({ ...f, batch: v, course_name: "" }))}
              options={batches.map((b) => ({ value: b, label: b }))}
              placeholder="Select your batch"
            />
          </Field>
          <Field label="Course" htmlFor="se-course" hint={!form.batch ? "Select a batch first." : undefined}>
            <OptionSelect
              id="se-course"
              value={form.course_name}
              onChange={set("course_name")}
              options={courses.map((c) => ({ value: c, label: c }))}
              placeholder={form.batch ? "Select the course" : "—"}
            />
          </Field>
          <Field label="Date the exam was held" htmlFor="se-date">
            <Input id="se-date" type="date" max={todayIso()} value={form.exam_date} onChange={(e) => set("exam_date")(e.target.value)} />
          </Field>
          <Field label="Shift" htmlFor="se-shift">
            <OptionSelect id="se-shift" value={form.shift} onChange={set("shift")} options={SHIFT_OPTIONS} placeholder="Select shift" />
          </Field>
          <Field label="Phone number" htmlFor="se-phone">
            <Input id="se-phone" type="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="+252 61 ..." maxLength={30} />
          </Field>
          <Field label="Reason" htmlFor="se-reason" className="sm:col-span-2">
            <Textarea
              id="se-reason"
              rows={4}
              value={form.reason}
              onChange={(e) => set("reason")(e.target.value)}
              maxLength={2000}
              placeholder="Why did you miss the exam?"
            />
          </Field>
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={saving}>
              <Send /> {saving ? "Sending..." : "Submit request"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DecisionMessage({ request }) {
  if (request.status === "pending") {
    return <p className="text-sm text-muted-foreground">Waiting for the Administration Team to decide.</p>;
  }
  const approved = request.status === "approved";
  const Icon = approved ? CheckCircle2 : XCircle;
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${approved ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10"}`}>
      <p className={`flex items-center gap-1.5 font-medium ${approved ? "text-success" : "text-danger"}`}>
        <Icon className="h-4 w-4" /> Your request was {approved ? "approved" : "declined"}.
      </p>
      {request.decision_note && <p className="mt-1 text-foreground">{request.decision_note}</p>}
      {request.decided_at && <p className="mt-1 text-xs text-muted-foreground">Decided {formatDateTime(request.decided_at)}</p>}
    </div>
  );
}

export default function StudentSpecialExams() {
  const { data, loading, error, reload } = useApi("/special-exams/mine", []);

  return (
    <div className="space-y-6">
      <PageHeader title="Special exams" description="Missed an exam? Register for a special exam and follow the decision here." />
      <RequestForm onCreated={reload} />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">My requests</h2>
        {error && <Alert>{error}</Alert>}
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : (data || []).length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <CalendarX2 className="h-10 w-10 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">You haven't registered for any special exam yet.</p>
          </Card>
        ) : (
          data.map((r) => (
            <Card key={r.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{r.course_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.batch} · Exam of {formatDay(r.exam_date)} · Shift {r.shift} · Sent {formatDateTime(r.created_at)}
                  </p>
                </div>
                <RequestStatusBadge status={r.status} />
              </div>
              <p className="whitespace-pre-line text-sm">{r.reason}</p>
              <DecisionMessage request={r} />
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
