import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field, FileInput, OptionSelect, useApi } from "@/components/committees/shared";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, toFormData } from "@/lib/committees";

/** Administration Team: upload the finalised minutes. Publishing records the
 * release date, archives the minutes and sends an Information Sharing notice. */
export default function PublishMinutes() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pending = useApi("/minutes/pending-meetings", []);
  const committees = useApi("/committees/options", []);
  const [form, setForm] = useState({
    meeting_id: params.get("meeting_id") || "",
    committee_id: "",
    title: "",
    meeting_date: "",
    summary: "",
    visibility: "committee",
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const meeting = (pending.data || []).find((m) => String(m.id) === String(form.meeting_id));
  useEffect(() => {
    if (meeting) setForm((f) => ({ ...f, title: f.title || meeting.title, meeting_date: meeting.date }));
  }, [meeting]);

  async function submit(e) {
    e.preventDefault();
    if (!file) {
      toast.error("Attach the finalised minutes document");
      return;
    }
    setSaving(true);
    const body = { ...form, file };
    if (form.meeting_id) delete body.committee_id;
    try {
      const res = await client.post("/minutes", toFormData(body));
      toast.success("Minutes published and distributed.");
      navigate(`/meeting-minutes/${res.data.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Publish meeting minutes"
        description="The release date and time are recorded when you publish. The minutes go into the archive, and an Information Sharing notice is sent to the committee, or to all faculty staff."
      />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Meeting" htmlFor="pm-meeting" hint="Held meetings that don't have minutes yet. Leave empty to publish minutes for a meeting that isn't in the system.">
              <OptionSelect
                id="pm-meeting"
                value={form.meeting_id}
                onChange={set("meeting_id")}
                anyLabel="Not listed: choose the committee instead"
                options={(pending.data || []).map((m) => ({ value: m.id, label: `${m.title} · ${m.committee_name} · ${formatDate(m.date)}` }))}
              />
            </Field>
            {!form.meeting_id && (
              <Field label="Committee / administrative unit" htmlFor="pm-committee">
                <OptionSelect
                  id="pm-committee"
                  value={form.committee_id}
                  onChange={set("committee_id")}
                  placeholder="Choose a committee"
                  options={(committees.data || []).map((c) => ({ value: c.id, label: `${c.name} (${c.kind_label})` }))}
                />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="pm-title">
                <Input id="pm-title" required maxLength={255} value={form.title} onChange={(e) => set("title")(e.target.value)} />
              </Field>
              <Field label="Meeting date" htmlFor="pm-date">
                <Input id="pm-date" type="date" required value={form.meeting_date} onChange={(e) => set("meeting_date")(e.target.value)} />
              </Field>
            </div>
            <Field label="Summary (optional)" htmlFor="pm-summary" hint="Shown on the printable minutes page and in the notification.">
              <Textarea id="pm-summary" rows={4} value={form.summary} onChange={(e) => set("summary")(e.target.value)} />
            </Field>
            <Field label="Who is notified" htmlFor="pm-vis">
              <OptionSelect
                id="pm-vis"
                value={form.visibility}
                onChange={set("visibility")}
                options={[
                  { value: "committee", label: "Committee members only" },
                  { value: "faculty", label: "Faculty-wide: all staff are notified and emailed" },
                ]}
              />
            </Field>
            <Field label="Finalised minutes document" htmlFor="pm-file" hint="PDF recommended, up to 15 MB.">
              <FileInput id="pm-file" onChange={setFile} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                <FileUp /> {saving ? "Publishing..." : "Publish minutes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
