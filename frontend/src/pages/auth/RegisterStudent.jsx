import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { AuthLayout, PasswordInput } from "@/components/auth-layout";
import FaceCapture, { faceFormData } from "@/components/FaceCapture.jsx";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STEP_COPY = {
  form: {
    title: "Create your student account",
    subtitle: "You'll use this to check in to your classes and view your attendance.",
  },
  face: {
    title: "Register your face",
    subtitle: "At every check-in your face is matched to this one, so only you can record your attendance.",
  },
  done: { title: "Almost done", subtitle: "Confirm your email to finish." },
};

export default function RegisterStudent() {
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    student_id_number: "",
    batch: "",
  });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState("form"); // form | face | done
  const [enrollToken, setEnrollToken] = useState("");
  const [faceError, setFaceError] = useState("");
  const [doneMessage, setDoneMessage] = useState("");

  useEffect(() => {
    client.get("/auth/batches").then((res) => setBatches(res.data)).catch(() => {});
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
    if (!form.batch) {
      setError("Please select your batch");
      return;
    }
    if (!consent) {
      setError("Please agree to the use of your face for attendance verification");
      return;
    }

    setSubmitting(true);
    try {
      const { confirm, ...fields } = form;
      const res = await client.post("/auth/register-student", { ...fields, face_consent: true });
      setEnrollToken(res.data.enroll_token);
      setStep("face");
    } catch (err) {
      setError(apiErrorMessage(err, "Registration failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFace(capture) {
    setFaceError("");
    try {
      const res = await client.post("/auth/enroll-face", faceFormData(capture, { enroll_token: enrollToken }));
      setDoneMessage(res.data.message);
      setStep("done");
    } catch (err) {
      setFaceError(apiErrorMessage(err, "Face registration failed. Please try again."));
    }
  }

  return (
    <AuthLayout
      wide={step === "form"}
      title={STEP_COPY[step].title}
      subtitle={STEP_COPY[step].subtitle}
      footer={
        <p>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      {step === "done" && (
        <div className="space-y-4">
          <Alert variant="success">{doneMessage}</Alert>
          <p className="text-sm text-muted-foreground">
            Didn't get it? Check your spam folder, or{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              go back and try signing in
            </Link>{" "}
            once you've confirmed.
          </p>
        </div>
      )}

      {step === "face" && <FaceCapture frontalCount={3} onCapture={handleFace} error={faceError} startLabel="Register my face" />}

      {step === "form" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required autoComplete="name" {...field("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" {...field("email")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" required autoComplete="new-password" {...field("password")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm</Label>
              <PasswordInput id="confirm" required autoComplete="new-password" {...field("confirm")} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sid">Student ID number</Label>
              <Input id="sid" required {...field("student_id_number")} />
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

          <label htmlFor="consent" className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
            <span className="text-muted-foreground">
              I agree that my face is registered (a face template, plus a profile photo from the scan) and used only to confirm
              my identity when I check in to classes. The faculty office can delete it on request.
            </span>
          </label>

          {error && <Alert>{error}</Alert>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            <UserPlus /> {submitting ? "Creating account..." : "Create account"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
