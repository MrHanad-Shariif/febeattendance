import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { AuthLayout } from "@/components/auth-layout";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await client.post("/auth/forgot-password", { email });
      setMessage(res.data.message);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
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
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            <Send /> {submitting ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
