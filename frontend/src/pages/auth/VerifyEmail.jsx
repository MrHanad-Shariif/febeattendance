import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext.jsx";
import { AuthLayout } from "@/components/auth-layout";
import { Alert } from "@/components/page-header";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [status, setStatus] = useState("verifying"); // verifying | done | pending_approval | error
  const [message, setMessage] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }
    client
      .get(`/auth/verify-email/${token}`)
      .then((res) => {
        if (res.data.pending_approval) {
          setStatus("pending_approval");
          setMessage(res.data.message);
        } else {
          setStatus("done");
          login(res.data.access_token, res.data.user);
          setTimeout(() => navigate("/"), 1200);
        }
      })
      .catch((err) => {
        setStatus("error");
        setMessage(apiErrorMessage(err, "This link is invalid or has expired"));
      });
  }, [token]);

  return (
    <AuthLayout
      title="Email confirmation"
      footer={
        status === "pending_approval" || status === "error" ? (
          <Link to="/login" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        ) : null
      }
    >
      {status === "verifying" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Confirming your email...
        </p>
      )}
      {status === "done" && <Alert variant="success">Email confirmed! Taking you in...</Alert>}
      {status === "pending_approval" && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{message}</div>
      )}
      {status === "error" && <Alert>{message}</Alert>}
    </AuthLayout>
  );
}
