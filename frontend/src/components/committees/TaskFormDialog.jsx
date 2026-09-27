import { useEffect, useState } from "react";
import { ClipboardPlus } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITIES, toLocalInput } from "@/lib/committees";
import { Field, OptionSelect } from "./shared";

/**
 * Assign a new task (committeeId + members) or edit an existing one (task).
 * The assignee is picked from the committee's members; their registered
 * email is used automatically by the server.
 */
export function TaskFormDialog({ open, onOpenChange, committeeId, members = [], task, onSaved }) {
  const editing = !!task;
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: task?.title || "",
      description: task?.description || "",
      assigned_to_id: task?.assigned_to_id ? String(task.assigned_to_id) : "",
      deadline: toLocalInput(task?.deadline),
      priority: task?.priority || "normal",
    });
  }, [open, task]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.assigned_to_id) {
      toast.error("Choose the member to assign this task to");
      return;
    }
    setSaving(true);
    const body = { ...form, assigned_to_id: Number(form.assigned_to_id), deadline: form.deadline || null };
    try {
      const res = editing
        ? await client.put(`/tasks/${task.id}`, body)
        : await client.post(`/committees/${committeeId}/tasks`, body);
      toast.success(editing ? "Task updated" : "Task assigned. The member has been notified by email.");
      onOpenChange(false);
      onSaved?.(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPlus className="h-5 w-5 text-primary" /> {editing ? "Edit task" : "Assign task"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes are recorded in the task history and the assignee is notified."
                : "The member receives a notification and an email at their registered address."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Assign to" htmlFor="task-assignee">
            <OptionSelect
              id="task-assignee"
              value={form.assigned_to_id}
              onChange={set("assigned_to_id")}
              placeholder="Choose a committee member"
              options={members.map((m) => ({
                value: m.user_id,
                label: `${m.name}${m.role !== "member" ? ` (${m.role})` : ""}`,
              }))}
            />
          </Field>
          <Field label="Task title" htmlFor="task-title">
            <Input id="task-title" required maxLength={255} value={form.title || ""} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="task-desc">
            <Textarea id="task-desc" rows={4} value={form.description || ""} onChange={(e) => set("description")(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deadline" htmlFor="task-deadline">
              <Input id="task-deadline" type="datetime-local" value={form.deadline || ""} onChange={(e) => set("deadline")(e.target.value)} />
            </Field>
            <Field label="Priority" htmlFor="task-priority">
              <OptionSelect id="task-priority" value={form.priority} onChange={set("priority")} options={PRIORITIES} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : editing ? "Save changes" : "Assign task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
