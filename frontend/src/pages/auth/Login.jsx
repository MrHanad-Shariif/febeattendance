import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import { AuthLayout, PasswordInput } from "@/components/auth-layout";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await client.post("/auth/login", { email, password });
      login(res.data.access_token, res.data.user);
      // Return to the page a scanned QR code opened (e.g. /checkin), so a wrong-code
      // scan is still caught after signing in.
      const from = location.state?.from;
      const safeFrom = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : null;
      navigate(safeFrom || (res.data.user.role === "admin" ? "/admin" : "/"));
    } catch (err) {
      setError(apiErrorMessage(err, "Login failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to FEBEMS"
      footer={
        <>
          <p>
            <Link to="/forgot-password" className="font-medium text-primary hover:underline">
              Forgot your password?
            </Link>
          </p>
          <p>
            Student?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          <LogIn /> {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
