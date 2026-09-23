import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { AuthLayout, PasswordInput } from "@/components/auth-layout";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function RegisterStudent() {
  const [batches, setBatches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    student_id_number: "",
    department: "",
    batch: "",
  });
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState("");

  useEffect(() => {
    client.get("/auth/batches").then((res) => setBatches(res.data)).catch(() => {});
    client.get("/auth/departments").then((res) => setDepartments(res.data)).catch(() => {});
  }, []);

  const field = (name) => ({ value: form[name], onChange: (e) => setForm({ ...form, [name]: e.target.value }) });

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!form.department || !form.batch) {
      setError("Please select your department and batch");
      return;
    }
    if (!photo) {
      setError("A photo is required");
      return;
    }

    const data = new FormData();
    data.append("name", form.name);
    data.append("email", form.email);
    data.append("password", form.password);
    data.append("student_id_number", form.student_id_number);
    data.append("department", form.department);
    data.append("batch", form.batch);
    data.append("photo", photo);

    setSubmitting(true);
    try {
      const res = await client.post("/auth/register-student", data);
      setSubmittedMessage(res.data.message);
    } catch (err) {
      setError(apiErrorMessage(err, "Registration failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      wide
      title="Create your student account"
      subtitle="You'll use this to check in to your classes and view your attendance."
      footer={
        <p>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      {submittedMessage ? (
        <div className="space-y-4">
          <Alert variant="success">{submittedMessage}</Alert>
          <p className="text-sm text-muted-foreground">
            Didn't get it? Check your spam folder, or{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              go back and try signing in
            </Link>{" "}
            once you've confirmed.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required {...field("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required {...field("email")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" required {...field("password")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm</Label>
              <PasswordInput id="confirm" required {...field("confirm")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sid">Student ID number</Label>
            <Input id="sid" required {...field("student_id_number")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={form.department || undefined} onValueChange={(v) => setForm({ ...form, department: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Batch / class</Label>
              <Select value={form.batch || undefined} onValueChange={(v) => setForm({ ...form, batch: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="photo">Photo</Label>
            <Input
              id="photo"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0] || null)}
              className="h-auto py-1.5"
            />
          </div>

          {error && <Alert>{error}</Alert>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            <UserPlus /> {submitting ? "Creating account..." : "Create account"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
