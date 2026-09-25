import { useEffect, useState } from "react";
import { Save, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { initials } from "@/lib/utils";

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
  student_verification_mode: "Campus verification mode",
  student_face_verification: "Face verification",
  face_match_threshold: "Face match strictness (0-1)",
  face_max_attempts_per_session: "Face scan attempts per class",
  student_lates_equal_absent: "Lates that equal 1 absence",
  student_absence_threshold_percent: "Absence % that blocks check-in / flags retake",
  semester_start_date: "Semester start date (fallback estimate)",
  semester_end_date: "Semester end date (fallback estimate)",
};

const FIELD_LABELS = { ...LECTURER_FIELD_LABELS, ...STUDENT_FIELD_LABELS };
const LECTURER_FIELD_ORDER = Object.keys(LECTURER_FIELD_LABELS);
const STUDENT_FIELD_ORDER = Object.keys(STUDENT_FIELD_LABELS);

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
};

function SettingField({ fieldKey, settings, descriptions, setSettings }) {
  const update = (value) => setSettings((s) => ({ ...s, [fieldKey]: value }));
  return (
    <div className="grid gap-1.5 py-4 sm:grid-cols-3 sm:gap-6">
      <Label htmlFor={fieldKey} className="sm:pt-2.5">
        {FIELD_LABELS[fieldKey]}
      </Label>
      <div className="sm:col-span-2">
        {SELECT_OPTIONS[fieldKey] ? (
          <Select value={settings[fieldKey] || undefined} onValueChange={update}>
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
  const [settings, setSettings] = useState({});
  const [descriptions, setDescriptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [admins, setAdmins] = useState([]);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminError, setAdminError] = useState("");
  const [toRemove, setToRemove] = useState(null);

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
    client.get("/admin/admins").then((res) => setAdmins(res.data)).catch(() => {});
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

  async function handleAddAdmin(e) {
    e.preventDefault();
    setAdminError("");
    try {
      await client.post("/admin/admins", { name: adminName, email: adminEmail });
      toast.success(`Invite sent to ${adminEmail}`);
      setAdminName("");
      setAdminEmail("");
      client.get("/admin/admins").then((res) => setAdmins(res.data));
    } catch (err) {
      setAdminError(apiErrorMessage(err));
    }
  }

  async function handleDeleteAdmin(a) {
    try {
      await client.delete(`/admin/admins/${a.id}`);
      setAdmins((prev) => prev.filter((x) => x.id !== a.id));
      toast.success("Admin removed");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const fieldProps = { settings, descriptions, setSettings };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="These mirror the rules from the original attendance spreadsheet." />

      <Tabs defaultValue="lecturer">
        <TabsList>
          <TabsTrigger value="lecturer">Lecturer rules</TabsTrigger>
          <TabsTrigger value="student">Student rules</TabsTrigger>
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

            {error && (
              <div className="mt-4">
                <Alert>{error}</Alert>
              </div>
            )}

            <div className="sticky bottom-4 mt-4 flex justify-end">
              <Button type="submit" disabled={saving} className="shadow-lg">
                <Save /> {saving ? "Saving..." : "Save settings"}
              </Button>
            </div>
          </form>
        )}

        <TabsContent value="admins">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" /> Admin & staff accounts
              </CardTitle>
              <CardDescription>Invite colleagues to manage the system.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <form onSubmit={handleAddAdmin} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="admin-name">Name</Label>
                  <Input id="admin-name" required value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input id="admin-email" type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                </div>
                <Button type="submit">
                  <UserPlus /> Invite admin
                </Button>
              </form>

              {adminError && <Alert>{adminError}</Alert>}

              <ul className="divide-y rounded-lg border">
                {admins.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{initials(a.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setToRemove(a)}>
                      <Trash2 /> Remove
                    </Button>
                  </li>
                ))}
                {admins.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No other admins.</li>}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={`Remove ${toRemove?.name}?`}
        description="This admin account will be deleted and can no longer sign in."
        confirmLabel="Remove"
        onConfirm={() => handleDeleteAdmin(toRemove)}
      />
    </div>
  );
}
