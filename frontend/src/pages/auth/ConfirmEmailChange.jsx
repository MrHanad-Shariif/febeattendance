import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { AuthLayout } from "@/components/auth-layout";
import { Alert } from "@/components/page-header";

/** Opened from the link sent to a student's new email address. */
export default function ConfirmEmailChange() {
  const { token } = useParams();
  const [state, setState] = useState({ status: "working", message: "" });
  useEffect(() => {
    client
      .post(`/auth/confirm-email-change/${token}`)
      .then((res) => setState({ status: "done", message: res.data.message }))
      .catch((err) => setState({ status: "error", message: apiErrorMessage(err) }));
  }, [token]);
  return (
    <AuthLayout title="Confirm your new email" subtitle="FEBEMS student account">
      {state.status === "working" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Confirming...
        </p>
      )}
      {state.status !== "working" && <Alert variant={state.status === "done" ? "success" : "error"}>{state.message}</Alert>}
      <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
        Go to sign in
      </Link>
    </AuthLayout>
  );
}
