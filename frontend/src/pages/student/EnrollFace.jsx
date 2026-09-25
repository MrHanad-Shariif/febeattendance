import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { AuthLayout } from "@/components/auth-layout";
import FaceCapture, { faceFormData } from "@/components/FaceCapture.jsx";
import { useAuth } from "@/context/AuthContext.jsx";

// Students who registered before face check-in existed (or whose face an
// admin reset) land here after signing in, and return to where they were going.
export default function EnrollFace() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");

  const from = location.state?.from;
  const next = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  if (user?.face_enrolled) return <Navigate to={next} replace />;

  async function handleCapture(capture) {
    setError("");
    try {
      const res = await client.post("/student/face", faceFormData(capture));
      updateUser(res.data.user);
      toast.success("Your face has been registered");
      navigate(next, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Face registration failed. Please try again."));
    }
  }

  return (
    <AuthLayout
      title="Register your face"
      subtitle="Before you can check in, register your face. At every check-in it's matched to this one, so only you can record your attendance."
      footer={
        <button type="button" onClick={logout} className="font-medium text-primary hover:underline">
          Sign out
        </button>
      }
    >
      <div className="space-y-4">
        <FaceCapture frontalCount={3} onCapture={handleCapture} error={error} startLabel="Register my face" />
        <p className="text-xs text-muted-foreground">
          By registering, you agree that your face (a face template, plus a profile photo from the scan) is stored and used
          only to confirm your identity when you check in to classes. The faculty office can delete it on request.
        </p>
      </div>
    </AuthLayout>
  );
}
