import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIONS, groupCatalogue } from "./Roles.jsx";

const ACTION_TONE = { view: "secondary", add: "success", edit: "default", delete: "danger" };

/**
 * Authentication > Permissions: the fixed catalogue of "<resource>:<action>"
 * permissions the system checks, and which roles currently grant each one.
 * Permissions are defined by the application; roles are what admins edit.
 */
export default function Permissions() {
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    client
      .get("/access/permissions")
      .then((res) => setCatalogue(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (res, a) =>
      !q ||
      [res.label, res.resource, a.code, a.description, ...a.roles].some((t) => t && t.toLowerCase().includes(q));
    const filtered = catalogue
      .map((res) => ({ ...res, actions: res.actions.filter((a) => matches(res, a)) }))
      .filter((res) => res.actions.length);
    return groupCatalogue(filtered);
  }, [catalogue, query]);

  const total = catalogue.reduce((n, r) => n + r.actions.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permissions"
        description={`${total} permissions across ${catalogue.length} screens. Each is one action (view, add, edit or delete) on one screen or record type; roles bundle them.`}
      />

      {error && <Alert>{error}</Alert>}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search permission, screen or role..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        groups.map((g) => (
          <Card key={g.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{g.name}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Permission</th>
                    <th className="px-4 py-2 text-left font-medium">Allows</th>
                    <th className="px-4 py-2 text-left font-medium">Granted by roles</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {g.resources.flatMap((res) =>
                    ACTIONS.map((col) => res.actions.find((a) => a.action === col.key))
                      .filter(Boolean)
                      .map((a) => (
                        <tr key={a.code} className="align-top hover:bg-accent/40">
                          <td className="px-4 py-2.5">
                            <p className="flex items-center gap-2 font-medium">
                              {res.label}
                              <Badge variant={ACTION_TONE[a.action]}>{a.label}</Badge>
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">{a.code}</p>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{a.description}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {a.roles.map((r) => (
                                <Badge key={r} variant="outline">
                                  {r}
                                </Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
