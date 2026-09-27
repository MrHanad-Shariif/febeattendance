import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Save, UserCog } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext.jsx";

const LECTURER_FIELD_LABELS = {
  site_name: "Site name",
  late_after_minutes: "Late after (minutes)",
  absent_after_minutes: "Absent after (minutes)",
  left_early_minutes: "Left early threshold (minutes)",
  no_checkout_after_minutes: "No check-out after (minutes)",
  reminder_minutes_before: "Reminder before class (minutes)",
  verification_mode: "Campus verification mode",
  location_rule: "Location rule (legacy)",
  campus_lat: "Campus latitude",
  campus_lng: "Campus longitude",
  campus_radius_m: "Campus radius (metres)",
  no_class_dates: "No-class dates (comma separated, yyyy-mm-dd)",
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
  semester_start_date: "Semester start date (fallback estimate)",
  semester_end_date: "Semester end date (fallback estimate)",
};

const COMMITTEE_FIELD_LABELS = {
  dean_task_override: "Dean may manage any committee",
};

const FIELD_LABELS = { ...LECTURER_FIELD_LABELS, ...STUDENT_FIELD_LABELS, ...COMMITTEE_FIELD_LABELS };
const LECTURER_FIELD_ORDER = Object.keys(LECTURER_FIELD_LABELS);
const STUDENT_FIELD_ORDER = Object.keys(STUDENT_FIELD_LABELS);
const COMMITTEE_FIELD_ORDER = Object.keys(COMMITTEE_FIELD_LABELS);

const DATE_KEYS = new Set(["semester_start_date", "semester_end_date"]);
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
};

function SettingField({ fieldKey, settings, descriptions, setSettings, disabled }) {
  const update = (value) => setSettings((s) => ({ ...s, [fieldKey]: value }));
  return (
    <div className="grid gap-1.5 py-4 sm:grid-cols-3 sm:gap-6">
      <Label htmlFor={fieldKey} className="sm:pt-2.5">
        {FIELD_LABELS[fieldKey]}
      </Label>
      <div className="sm:col-span-2">
        {SELECT_OPTIONS[fieldKey] ? (
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
            type={DATE_KEYS.has(fieldKey) ? "date" : "text"}
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
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await client.put("/admin/settings", settings);
      toast.success("Settings saved");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const fieldProps = { settings, descriptions, setSettings, disabled: !canEdit };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="These mirror the rules from the original attendance spreadsheet." />

      <Tabs defaultValue="lecturer">
        <TabsList>
          <TabsTrigger value="lecturer">Lecturer rules</TabsTrigger>
          <TabsTrigger value="student">Student rules</TabsTrigger>
          <TabsTrigger value="committees">Committees</TabsTrigger>
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
            <TabsContent value="lecturer">
              <SettingsCard
                title="Lecturer attendance rules"
                description="Thresholds and campus verification for lecturer check-ins."
                fields={LECTURER_FIELD_ORDER}
                {...fieldProps}
              />
            </TabsContent>
            <TabsContent value="student">
              <SettingsCard
                title="Student attendance rules"
                description="Thresholds, retake rule and semester dates for student check-ins."
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
