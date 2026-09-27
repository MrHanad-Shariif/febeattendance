import { useEffect, useMemo, useState } from "react";
import { Copy, Eye, Lock, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext.jsx";
import { cn } from "@/lib/utils";

export const ACTION_TONE = { view: "secondary", add: "success", edit: "default", delete: "danger" };

const TYPE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "custom", label: "Custom" },
];

export const ACTIONS = [
  { key: "view", label: "View" },
  { key: "add", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
];

/** Group the catalogue's resources under their headings (Lecturers, Students...). */
export function groupCatalogue(catalogue) {
  const groups = [];
  for (const res of catalogue) {
    let g = groups.find((x) => x.name === res.group);
    if (!g) groups.push((g = { name: res.group, resources: [] }));
    g.resources.push(res);
  }
  return groups;
}

/**
 * Resource x action grid of checkboxes: each row is a screen or record type,
 * each column one of View / Add / Edit / Delete. Cells a resource doesn't
 * support are blank. Ticking Add/Edit/Delete also ticks View, since those
 * screens can't be reached without it.
 */
function PermissionMatrix({ catalogue, value, onChange, disabled }) {
  const selected = new Set(value);
  const set = (codes, on) => {
    const next = new Set(selected);
    codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
    onChange([...next]);
  };
  const toggle = (res, action, on) => {
    const codes = [`${res.resource}:${action}`];
    const view = `${res.resource}:view`;
    if (on && action !== "view" && res.actions.some((a) => a.action === "view")) codes.push(view);
    if (!on && action === "view") codes.push(...res.actions.map((a) => a.code)); // no edit without view
    set(codes, on);
  };
  const rowState = (res) => {
    const n = res.actions.filter((a) => selected.has(a.code)).length;
    return n === 0 ? false : n === res.actions.length ? true : "indeterminate";
  };
  const columnCodes = (action) => catalogue.flatMap((r) => r.actions.filter((a) => a.action === action).map((a) => a.code));
  const columnState = (action) => {
    const codes = columnCodes(action);
    const n = codes.filter((c) => selected.has(c)).length;
    return n === 0 ? false : n === codes.length ? true : "indeterminate";
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Screen / record</th>
            {ACTIONS.map((a) => (
              <th key={a.key} className="w-20 px-2 py-2 text-center font-medium">
                <label className="flex flex-col items-center gap-1">
                  {a.label}
                  <Checkbox
                    aria-label={`All ${a.label}`}
                    disabled={disabled}
                    checked={columnState(a.key)}
                    onCheckedChange={(on) => set(columnCodes(a.key).concat(on && a.key !== "view" ? columnCodes("view") : []), !!on)}
                  />
                </label>
              </th>
            ))}
            <th className="w-16 px-2 py-2 text-center font-medium">All</th>
          </tr>
        </thead>
        {groupCatalogue(catalogue).map((g) => (
          <tbody key={g.name} className="divide-y border-t">
            <tr className="bg-muted/20">
              <td colSpan={ACTIONS.length + 2} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                {g.name}
              </td>
            </tr>
            {g.resources.map((res) => (
              <tr key={res.resource} className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <p className="font-medium">{res.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{res.resource}</p>
                </td>
                {ACTIONS.map((a) => {
                  const action = res.actions.find((x) => x.action === a.key);
                  return (
                    <td key={a.key} className="px-2 py-2 text-center" title={action?.description}>
                      {action ? (
                        <Checkbox
                          aria-label={`${res.label}: ${a.label}`}
                          disabled={disabled}
                          checked={selected.has(action.code)}
                          onCheckedChange={(on) => toggle(res, a.key, !!on)}
                        />
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-center">
                  <Checkbox
                    aria-label={`${res.label}: all`}
                    disabled={disabled}
                    checked={rowState(res)}
                    onCheckedChange={(on) => set(res.actions.map((x) => x.code), !!on)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const EMPTY = { id: null, name: "", description: "", permissions: [] };

/**
 * Authentication > Roles: bundles of fine-grained permissions. Users are
 * given roles, never raw permissions, so "edit rights on the timetable" is
 * a role with timetable:view + timetable:edit assigned on the Users page.
 */
export default function Roles() {
  const { can } = useAuth();
  const [roles, setRoles] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  function load() {
    Promise.all([client.get("/access/roles"), client.get("/access/permissions")])
      .then(([r, p]) => {
        setRoles(r.data);
        setCatalogue(p.data);
        setError("");
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const labels = useMemo(() => {
    const map = {};
    catalogue.forEach((res) => res.actions.forEach((a) => (map[a.code] = `${res.label}: ${a.label}`)));
    return map;
  }, [catalogue]);

  const canEdit = can("roles:edit");
  const canAdd = can("roles:add");
  const canDelete = can("roles:delete");

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        meta: { label: "Role" },
        cell: ({ row }) => (
          <div className="flex min-w-[200px] items-start gap-2.5">
            {row.original.is_system ? (
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
            ) : (
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <p className="font-medium">{row.original.name}</p>
              {row.original.description && <p className="line-clamp-2 text-xs text-muted-foreground">{row.original.description}</p>}
            </div>
          </div>
        ),
      },
      {
        id: "type",
        accessorFn: (r) => (r.is_system ? "system" : "custom"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        meta: { label: "Type", exportValue: (r) => (r.is_system ? "System" : "Custom") },
        filterFn: exactFilter,
        cell: ({ row }) => <Badge variant={row.original.is_system ? "purple" : "muted"}>{row.original.is_system ? "System" : "Custom"}</Badge>,
      },
      {
        id: "access",
        header: "Access by action",
        enableSorting: false,
        meta: { label: "Access by action", exportValue: (r) => ACTIONS.map((a) => `${a.label} ${r.permissions.filter((c) => c.endsWith(`:${a.key}`)).length}`).join(", ") },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {ACTIONS.map((a) => {
              const n = row.original.permissions.filter((c) => c.endsWith(`:${a.key}`)).length;
              return (
                <Badge key={a.key} variant={n ? ACTION_TONE[a.key] : "outline"} className={n ? "" : "opacity-40"}>
                  {a.label} {n}
                </Badge>
              );
            })}
          </div>
        ),
      },
      {
        id: "permissions",
        accessorFn: (r) => r.permissions.length,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Permissions" />,
        meta: { label: "Permissions", className: "text-right tabular-nums", exportValue: (r) => r.permissions.map((c) => labels[c] || c).join("; ") },
      },
      {
        accessorKey: "user_count",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Users" />,
        meta: { label: "Users", className: "text-right tabular-nums" },
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        meta: { label: "Created" },
        cell: ({ row }) => (row.original.created_at ? new Date(row.original.created_at).toLocaleDateString() : "—"),
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) => {
          const role = row.original;
          const editable = !role.is_system && canEdit;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setForm({ ...role })}>
                    {editable ? <Pencil /> : <Eye />} {editable ? "Edit permissions" : "View permissions"}
                  </DropdownMenuItem>
                  {canAdd && (
                    <DropdownMenuItem
                      onSelect={() => setForm({ ...EMPTY, name: `${role.name} (copy)`, description: role.description || "", permissions: role.permissions })}
                    >
                      <Copy /> Duplicate
                    </DropdownMenuItem>
                  )}
                  {canDelete && !role.is_system && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(role)}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [labels, canEdit, canAdd, canDelete]
  );

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const body = { name: form.name, description: form.description, permissions: form.permissions };
    try {
      if (form.id) await client.put(`/access/roles/${form.id}`, body);
      else await client.post("/access/roles", body);
      toast.success(form.id ? `${form.name} updated` : `${form.name} created`);
      setForm(null);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role) {
    try {
      await client.delete(`/access/roles/${role.id}`);
      toast.success(`${role.name} deleted`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const readOnly = form && (form.is_system || (form.id ? !can("roles:edit") : !can("roles:add")));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="A role is a set of permissions: which screens a person can view, and whether they can add, edit or delete there."
        actions={
          can("roles:add") && (
            <Button onClick={() => setForm({ ...EMPTY })}>
              <Plus /> New role
            </Button>
          )
        }
      />

      {error && <Alert>{error}</Alert>}

      <DataTable
        columns={columns}
        data={roles}
        loading={loading}
        getRowId={(r) => String(r.id)}
        onRowClick={(r) => setForm({ ...r })}
        searchPlaceholder="Search roles..."
        filters={[{ columnId: "type", label: "Type", options: TYPE_OPTIONS }]}
        exportName="roles"
        emptyText="No roles yet."
      />

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          {form && (
            <form onSubmit={save} className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  {form.id ? (readOnly ? form.name : `Edit ${form.name}`) : "New role"}
                </DialogTitle>
                <DialogDescription>
                  {form.is_system
                    ? "Built-in role with every permission. It can't be changed."
                    : "Tick exactly what this role may do. Ticking Add, Edit or Delete also ticks View."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="role-name">Name</Label>
                  <Input id="role-name" required disabled={readOnly} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role-desc">Description</Label>
                  <Textarea
                    id="role-desc"
                    rows={1}
                    disabled={readOnly}
                    value={form.description || ""}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>
              <PermissionMatrix
                catalogue={catalogue}
                value={form.permissions}
                disabled={readOnly}
                onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
              />
              <p className={cn("text-xs text-muted-foreground")}>{form.permissions.length} permission(s) selected.</p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  {readOnly ? "Close" : "Cancel"}
                </Button>
                {!readOnly && (
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving..." : form.id ? "Save role" : "Create role"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name}?`}
        description={
          toDelete?.user_count
            ? `${toDelete.user_count} user(s) hold this role and will lose the access it gives.`
            : "No one holds this role."
        }
        confirmLabel="Delete"
        onConfirm={() => handleDelete(toDelete)}
      />
    </div>
  );
}
