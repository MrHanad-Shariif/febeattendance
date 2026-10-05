import { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Field } from "@/components/committees/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Alert } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext.jsx";

/**
 * A small add / edit / delete list (batches or rooms) the timetable picks from.
 * `fields`: [{ key, label, type?, placeholder?, required?, hint? }]
 */
function ListManager({ title, noun, endpoint, rows, loading, columns, fields, onChanged, emptyText }) {
  const { can } = useAuth();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null);

  function open(row) {
    setError("");
    setForm(row ? { ...row } : Object.fromEntries(fields.map((f) => [f.key, ""])));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (form.id) await client.put(`${endpoint}/${form.id}`, form);
      else await client.post(endpoint, form);
      toast.success(form.id ? `${noun} updated` : `${noun} added`);
      setForm(null);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    try {
      await client.delete(`${endpoint}/${row.id}`);
      toast.success(`${noun} deleted`);
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const allColumns = useMemo(
    () => [
      ...columns,
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: "",
        meta: { noExport: true, className: "w-12 text-right" },
        cell: ({ row }) =>
          (can("timetable:edit") || can("timetable:delete")) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {can("timetable:edit") && (
                  <DropdownMenuItem onSelect={() => open(row.original)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {can("timetable:delete") && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(row.original)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns]
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {can("timetable:add") && (
          <Button onClick={() => open(null)}>
            <Plus /> Add {noun.toLowerCase()}
          </Button>
        )}
      </div>
      <DataTable columns={allColumns} data={rows} loading={loading} getRowId={(r) => String(r.id)} searchPlaceholder={`Search ${title.toLowerCase()}...`} emptyText={emptyText} />

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          {form && (
            <form onSubmit={save} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{form.id ? `Edit ${noun.toLowerCase()}` : `Add ${noun.toLowerCase()}`}</DialogTitle>
                <DialogDescription>Used when adding classes and matched when a timetable is uploaded.</DialogDescription>
              </DialogHeader>
              {fields.map((f) => (
                <Field key={f.key} label={f.label} htmlFor={`lm-${f.key}`} hint={f.hint}>
                  <Input
                    id={`lm-${f.key}`}
                    type={f.type || "text"}
                    required={f.required}
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </Field>
              ))}
              {error && <Alert>{error}</Alert>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete this ${noun.toLowerCase()}?`}
        description={toDelete ? `${toDelete.code || toDelete.name} will be removed from the list.` : ""}
        confirmLabel="Delete"
        onConfirm={() => remove(toDelete)}
      />
    </div>
  );
}

export function BatchList({ rows, loading, onChanged }) {
  const columns = useMemo(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        meta: { label: "Batch" },
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.code} {row.original.combined && <Badge variant="info" className="ml-1">Shared class</Badge>}
          </span>
        ),
      },
      { accessorKey: "name", header: "Name", meta: { label: "Name" }, cell: ({ getValue }) => getValue() || "—" },
      { accessorKey: "department", header: "Department", meta: { label: "Department" }, cell: ({ getValue }) => getValue() || "—" },
      { accessorKey: "student_count", header: ({ column }) => <DataTableColumnHeader column={column} title="Students" />, meta: { label: "Students" } },
      { accessorKey: "class_count", header: ({ column }) => <DataTableColumnHeader column={column} title="Classes" />, meta: { label: "Classes" } },
    ],
    []
  );
  return (
    <ListManager
      title="Batches"
      noun="Batch"
      endpoint="/admin/batches"
      rows={rows}
      loading={loading}
      columns={columns}
      onChanged={onChanged}
      emptyText="No batches yet."
      fields={[
        { key: "code", label: "Batch code", required: true, placeholder: "e.g. BCE13", hint: "Two batches taught together: BTE13&BEE11." },
        { key: "name", label: "Name (optional)", placeholder: "e.g. Civil Engineering, 2026 intake" },
        { key: "department", label: "Department (optional)" },
        { key: "note", label: "Note (optional)" },
      ]}
    />
  );
}

export function RoomList({ rows, loading, onChanged }) {
  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Room" />,
        meta: { label: "Room" },
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      },
      { accessorKey: "building", header: "Building", meta: { label: "Building" }, cell: ({ getValue }) => getValue() || "—" },
      { accessorKey: "capacity", header: "Capacity", meta: { label: "Capacity" }, cell: ({ getValue }) => getValue() ?? "—" },
      { accessorKey: "class_count", header: ({ column }) => <DataTableColumnHeader column={column} title="Classes" />, meta: { label: "Classes" } },
    ],
    []
  );
  return (
    <ListManager
      title="Rooms"
      noun="Room"
      endpoint="/admin/rooms"
      rows={rows}
      loading={loading}
      columns={columns}
      onChanged={onChanged}
      emptyText="No rooms yet."
      fields={[
        { key: "name", label: "Room", required: true, placeholder: "e.g. 302 or Lab 1" },
        { key: "building", label: "Building (optional)" },
        { key: "capacity", label: "Capacity (optional)", type: "number" },
        { key: "note", label: "Note (optional)" },
      ]}
    />
  );
}
