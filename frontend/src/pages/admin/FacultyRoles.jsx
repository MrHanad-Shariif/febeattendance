import { useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { staffOptions, useStaff } from "@/components/committees/CommitteeFormDialog.jsx";
import { Field, OptionSelect, useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/committees";
import { initials } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext.jsx";

const ROLE_OPTIONS = [
  { value: "dean", label: "Dean" },
  { value: "admin_team", label: "Administration Team" },
];

/** Admin: give existing accounts faculty-level roles. One account can hold
 * several roles alongside being a lecturer and a committee member. */
export default function FacultyRoles() {
  const { can } = useAuth();
  const canEdit = can("faculty_roles:edit");
  const staff = useStaff();
  const { data, loading, error, reload } = useApi("/faculty-roles", []);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("dean");

  async function grant(e) {
    e.preventDefault();
    try {
      await client.post("/faculty-roles", { user_id: Number(userId), role });
      toast.success("Role granted");
      setUserId("");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function revoke(r) {
    try {
      await client.delete(`/faculty-roles/${r.id}`);
      toast.success("Role removed");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Faculty roles"
        description="Dean and Administration Team roles are added to existing accounts. They do not replace the lecturer role or create new accounts."
      />
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grant a role</CardTitle>
            <CardDescription>
              The Dean monitors every committee but only manages tasks in committees they chair. Administration Team members publish minutes and faculty information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={grant} className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
              <Field label="Staff member" htmlFor="fr-user">
                <OptionSelect id="fr-user" value={userId} onChange={setUserId} placeholder="Choose..." options={staffOptions(staff)} />
              </Field>
              <Field label="Role" htmlFor="fr-role">
                <OptionSelect id="fr-role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
              </Field>
              <Button type="submit" disabled={!userId}>
                <ShieldCheck /> Grant
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {error && <Alert>{error}</Alert>}
      <Card className="divide-y">
        {!loading && data.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No faculty roles granted yet.</p>}
        {data.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-6 py-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(r.user_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.user_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.user_email} · since {formatDate(r.granted_at)}
              </p>
            </div>
            <Badge variant={r.role === "dean" ? "warning" : "purple"}>{r.role_label}</Badge>
            {canEdit && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Remove role" onClick={() => revoke(r)}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
