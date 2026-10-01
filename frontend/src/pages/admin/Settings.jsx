import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Save, UserCog } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext.jsx";

const GENERAL_FIELD_LABELS = {
  site_name: "System name",
  semester_name: "Current semester",
  semester_start_date: "Semester start date",
  semester_end_date: "Semester end date",
  no_class_dates: "No-class dates (comma separated, yyyy-mm-dd)",
};

// One campus point and radius for everyone: lecturer and student check-ins
// are both measured against these same coordinates.
const LOCATION_FIELD_LABELS = {
  campus_lat: "Campus latitude",
  campus_lng: "Campus longitude",
  campus_radius_m: "Campus radius (metres)",
};

const LECTURER_FIELD_LABELS = {
  late_after_minutes: "Late after (minutes)",
  absent_after_minutes: "Absent after (minutes)",
  left_early_minutes: "Left early threshold (minutes)",
  no_checkout_after_minutes: "No check-out after (minutes)",
  reminder_minutes_before: "Reminder before class (minutes)",
  verification_mode: "Campus verification mode",
  location_rule: "Location rule (legacy)",
};

const STUDENT_FIELD_LABELS = {
  student_late_after_minutes: "Late after (minutes)",
  student_absent_after_minutes: "Absent after (minutes)",
  board_code_close_after_minutes: "Board check-in closes after (minutes from class start)",
  student_verification_mode: "Campus verification mode",
  student_face_verification: "Face verification",
  face_match_threshold: "Face match strictness (0-1)",
  face_max_attempts_per_session: "Face scan attempts per class",
  student_lates_equal_absent: "Lates that equal 1 absence",
  student_absence_threshold_percent: "Absence % that blocks check-in / flags retake",
};

const COMMITTEE_FIELD_LABELS = {
  dean_task_override: "Dean may manage any committee",
};

const EMAIL_SWITCH_LABELS = {
  email_mode: "Email sending",
  email_notifications: "Meeting, task & assignment emails",
  email_checkin_reminders: "Class check-in reminders",
  email_account_messages: "Account emails (invites, password resets)",
};

const EMAIL_HOURS_LABELS = {
  email_send_from: "Send emails from",
  email_send_until: "Send emails until",
  email_send_days: "Sending days",
};

const FIELD_LABELS = {
  ...GENERAL_FIELD_LABELS,
  ...LOCATION_FIELD_LABELS,
  ...LECTURER_FIELD_LABELS,
  ...STUDENT_FIELD_LABELS,
  ...COMMITTEE_FIELD_LABELS,
  ...EMAIL_SWITCH_LABELS,
  ...EMAIL_HOURS_LABELS,
};
const GENERAL_FIELD_ORDER = Object.keys(GENERAL_FIELD_LABELS);
const LOCATION_FIELD_ORDER = Object.keys(LOCATION_FIELD_LABELS);
const LECTURER_FIELD_ORDER = Object.keys(LECTURER_FIELD_LABELS);
const STUDENT_FIELD_ORDER = Object.keys(STUDENT_FIELD_LABELS);
const COMMITTEE_FIELD_ORDER = Object.keys(COMMITTEE_FIELD_LABELS);
const EMAIL_SWITCH_ORDER = Object.keys(EMAIL_SWITCH_LABELS);
const EMAIL_HOURS_ORDER = Object.keys(EMAIL_HOURS_LABELS);

const DATE_KEYS = new Set(["semester_start_date", "semester_end_date"]);
const TIME_KEYS = new Set(["email_send_from", "email_send_until"]);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ON_OFF = [
  ["on", "On"],
  ["off", "Off"],
];
const VERIFICATION_OPTIONS = [
  ["both", "Both code and location required"],
  ["either", "Either code or location"],
  ["code_only", "Code only"],
  ["location_only", "Location only"],
  ["off", "Off (no verification)"],
];
const SELECT_OPTIONS = {
  verification_mode: VERIFICATION_OPTIONS,
  student_verification_mode: VERIFICATION_OPTIONS,
  student_face_verification: [
    ["require", "Required: live face scan must match"],
    ["off", "Off (no face scan)"],
  ],
  dean_task_override: [
    ["off", "Off: only each committee's chairperson"],
    ["on", "On: the Dean may also assign tasks and schedule meetings"],
  ],
  email_mode: [
    ["on", "On: send emails"],
    ["paused", "Paused: hold emails and send them later"],
    ["off", "Off: send no emails at all"],
  ],
  email_notifications: ON_OFF,
  email_checkin_reminders: ON_OFF,
  email_account_messages: ON_OFF,
};

function DaysPicker({ value, onChange, disabled }) {
  const selected = new Set((value || "").split(",").filter(Boolean));
  const toggle = (day, checked) => {
    const next = new Set(selected);
    if (checked) next.add(day);
    else next.delete(day);
    onChange(WEEKDAYS.filter((d) => next.has(d)).join(","));
  };
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
      {WEEKDAYS.map((day) => (
        <label key={day} className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={selected.has(day)} onCheckedChange={(c) => toggle(day, c === true)} disabled={disabled} />
          {day}
        </label>
      ))}
    </div>
  );
}

const STATE_BADGES = {
  sending: ["Sending", "success"],
  waiting: ["Waiting for sending hours", "info"],
  paused: ["Paused", "warning"],
  off: ["Off", "danger"],
  unconfigured: ["Mail server not set up", "danger"],
};

function EmailStatus({ status }) {
  if (!status) return null;
  const [label, variant] = STATE_BADGES[status.state] || [status.state, "secondary"];
  const q = status.queue;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-primary" /> Email right now <Badge variant={variant}>{label}</Badge>
        </CardTitle>
        <CardDescription>{status.detail}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-2xl font-semibold">{q.pending}</div>
          <div className="text-muted-foreground">Waiting to send</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">{q.sent}</div>
          <div className="text-muted-foreground">Sent</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">{q.failed}</div>
          <div className="text-muted-foreground">Failed</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">{q.cancelled}</div>
          <div className="text-muted-foreground">Cancelled (email off)</div>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-4">
          Counts cover meeting, task and assignment emails.
          {status.last_sent_at && ` Last one sent ${new Date(status.last_sent_at).toLocaleString()}.`}
        </p>
      </CardContent>
    </Card>
  );
}

function SettingField({ fieldKey, settings, descriptions, setSettings, disabled }) {
  const update = (value) => setSettings((s) => ({ ...s, [fieldKey]: value }));
  return (
    <div className="grid gap-1.5 py-4 sm:grid-cols-3 sm:gap-6">
      <Label htmlFor={fieldKey} className="sm:pt-2.5">
        {FIELD_LABELS[fieldKey]}
      </Label>
      <div className="sm:col-span-2">
        {fieldKey === "email_send_days" ? (
          <DaysPicker value={settings[fieldKey]} onChange={update} disabled={disabled} />
        ) : SELECT_OPTIONS[fieldKey] ? (
          <Select value={settings[fieldKey] || undefined} onValueChange={update} disabled={disabled}>
            <SelectTrigger id={fieldKey}>
              <SelectValue placeholder="Choose a mode" />
            </SelectTrigger>
            <SelectContent>
              {SELECT_OPTIONS[fieldKey].map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={fieldKey}
            type={DATE_KEYS.has(fieldKey) ? "date" : TIME_KEYS.has(fieldKey) ? "time" : "text"}
            value={settings[fieldKey] || ""}
            disabled={disabled}
            onChange={(e) => update(e.target.value)}
          />
        )}
        {descriptions[fieldKey] && <p className="mt-1.5 text-xs text-muted-foreground">{descriptions[fieldKey]}</p>}
      </div>
    </div>
  );
}

function SettingsCard({ title, description, fields, ...rest }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {fields.map((key) => (
          <SettingField key={key} fieldKey={key} {...rest} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const canEdit = can("settings:edit");
  const [settings, setSettings] = useState({});
  const [descriptions, setDescriptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emailStatus, setEmailStatus] = useState(null);

  const loadEmailStatus = () =>
    client
      .get("/admin/email-status")
      .then((res) => setEmailStatus(res.data))
      .catch(() => setEmailStatus(null));

  useEffect(() => {
    client
      .get("/admin/settings")
      .then((res) => {
        const values = {};
        const descs = {};
        res.data.forEach((row) => {
          values[row.key] = row.value;
          descs[row.key] = row.description;
        });
        setSettings(values);
        setDescriptions(descs);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
    loadEmailStatus();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await client.put("/admin/settings", settings);
      toast.success("Settings saved");
      loadEmailStatus();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const fieldProps = { settings, descriptions, setSettings, disabled: !canEdit };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="System, semester, campus location and the attendance rules." />

      <Tabs defaultValue="general">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="general">General & semester</TabsTrigger>
          <TabsTrigger value="location">Campus location</TabsTrigger>
          <TabsTrigger value="lecturer">Lecturer rules</TabsTrigger>
          <TabsTrigger value="student">Student rules</TabsTrigger>
          <TabsTrigger value="committees">Committees</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="admins">Admin accounts</TabsTrigger>
        </TabsList>

        {loading ? (
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSave}>
            <TabsContent value="general">
              <SettingsCard
                title="System and semester"
                description="The system name, the current semester and the days without classes."
                fields={GENERAL_FIELD_ORDER}
                {...fieldProps}
              />
            </TabsContent>
            <TabsContent value="location">
              <SettingsCard
                title="Campus location (lecturers and students)"
                description="Lecturers and students are checked against this same point and radius, so both groups are on campus by the same definition."
                fields={LOCATION_FIELD_ORDER}
                {...fieldProps}
              />
            </TabsContent>
            <TabsContent value="lecturer">
              <SettingsCard
                title="Lecturer attendance rules"
                description="Thresholds and campus verification for lecturer check-ins. The campus point is under Campus location."
                fields={LECTURER_FIELD_ORDER}
                {...fieldProps}
              />
            </TabsContent>
            <TabsContent value="student">
              <SettingsCard
                title="Student attendance rules"
                description="Thresholds and the retake rule for student check-ins. Students use the same campus point as lecturers (Campus location)."
                fields={STUDENT_FIELD_ORDER}
                {...fieldProps}
              />
            </TabsContent>
            <TabsContent value="committees">
              <SettingsCard
                title="Committee permissions"
                description="Task management belongs to each committee's chairperson unless this override is switched on."
                fields={COMMITTEE_FIELD_ORDER}
                {...fieldProps}
              />
            </TabsContent>
            <TabsContent value="email" className="space-y-4">
              <EmailStatus status={emailStatus} />
              <SettingsCard
                title="What gets emailed"
                description="Turn all email on, pause it, or switch it off, and choose which kinds go out. In-app notifications are not affected."
                fields={EMAIL_SWITCH_ORDER}
                {...fieldProps}
              />
              <SettingsCard
                title="Sending hours"
                description="When emails may go out, in campus time. Account emails (invites, password resets) are always sent straight away."
                fields={EMAIL_HOURS_ORDER}
                {...fieldProps}
              />
            </TabsContent>

            {error && (
              <div className="mt-4">
                <Alert>{error}</Alert>
              </div>
            )}

            {canEdit && (
              <div className="sticky bottom-4 mt-4 flex justify-end">
                <Button type="submit" disabled={saving} className="shadow-lg">
                  <Save /> {saving ? "Saving..." : "Save settings"}
                </Button>
              </div>
            )}
          </form>
        )}

        <TabsContent value="admins">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCog className="h-4 w-4 text-primary" /> Admin & staff accounts
              </CardTitle>
              <CardDescription>
                Staff accounts, and exactly what each one can view, add, edit or delete, are managed under Authentication.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {can("users:view") && (
                <Button asChild variant="outline">
                  <Link to="/access/users">Users</Link>
                </Button>
              )}
              {can("roles:view") && (
                <Button asChild variant="outline">
                  <Link to="/access/roles">Roles</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  );
}
