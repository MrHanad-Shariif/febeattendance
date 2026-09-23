import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { AuthLayout, PasswordInput } from "@/components/auth-layout";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await client.post("/auth/reset-password", { token, password });
      setMessage(res.data.message);
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Use at least 8 characters."
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      }
    >
      {message ? (
        <Alert variant="success">{message}</Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <PasswordInput id="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <PasswordInput id="confirm" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Saving..." : "Reset password"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
