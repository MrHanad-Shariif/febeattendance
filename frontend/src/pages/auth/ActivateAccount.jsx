import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import { AuthLayout, PasswordInput } from "@/components/auth-layout";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function ActivateAccount() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setLoadError("Missing activation token");
      return;
    }
    client
      .get(`/auth/invite/${token}`)
      .then((res) => setInvite(res.data))
      .catch((err) => setLoadError(apiErrorMessage(err, "This link is invalid or has expired")));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await client.post("/auth/activate", { token, password });
      login(res.data.access_token, res.data.user);
      navigate(res.data.user.role === "admin" ? "/admin" : "/");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Activate your account"
      subtitle={invite && !loadError ? `Welcome, ${invite.name}. Set a password for ${invite.email}.` : undefined}
      footer={
        loadError ? (
          <Link to="/login" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        ) : null
      }
    >
      {loadError && <Alert>{loadError}</Alert>}

      {invite && !loadError && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <PasswordInput id="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <PasswordInput id="confirm" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Activating..." : "Activate account"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
