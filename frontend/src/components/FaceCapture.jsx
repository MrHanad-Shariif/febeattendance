import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Loader2, ScanFace } from "lucide-react";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FRAME_MAX_SIDE = 640;
const SETTLE_MS = 900; // let the student look at the camera before the first frame
const FRAME_GAP_MS = 350;
const TURN_MS = 2600; // time to turn the head before the turned frame

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Frames are drawn unmirrored (what the camera actually sees); only the
// on-screen preview is mirrored so it behaves like a mirror. The server's
// head-turn check relies on that.
function grabFrame(video) {
  const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

function cameraErrorMessage(err) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "Your browser can't open the camera here. Open this page in Chrome or Safari over a secure (https) connection.";
  }
  if (err?.name === "NotAllowedError") {
    return "Camera access was blocked. Allow camera access for this site in your browser settings, then try again.";
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
    return "No front camera was found on this device.";
  }
  return "The camera couldn't be started. Close other apps using it and try again.";
}

/**
 * Live face scan: opens the front camera, captures `frontalCount` frames while
 * the student looks straight, then one frame after they turn their head to
 * `direction` (their own left/right). Calls `onCapture({frontal, turned,
 * direction})` with JPEG blobs; the parent uploads them and shows errors via
 * `error`.
 */
export default function FaceCapture({ frontalCount = 1, direction, onCapture, error, startLabel = "Start face scan" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [localDirection] = useState(() => (Math.random() < 0.5 ? "left" : "right"));
  const turnTo = direction || localDirection;
  const [phase, setPhase] = useState("idle"); // idle | starting | ready | straight | turn | uploading
  const [cameraError, setCameraError] = useState("");

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => stopCamera, []);

  async function startCamera() {
    setCameraError("");
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setPhase("ready");
    } catch (err) {
      stopCamera();
      setCameraError(cameraErrorMessage(err));
      setPhase("idle");
    }
  }

  async function scan() {
    const video = videoRef.current;
    setPhase("straight");
    await wait(SETTLE_MS);
    const frontal = [];
    for (let i = 0; i < frontalCount; i++) {
      if (i) await wait(FRAME_GAP_MS);
      frontal.push(await grabFrame(video));
    }
    setPhase("turn");
    await wait(TURN_MS);
    const turned = await grabFrame(video);
    setPhase("uploading");
    try {
      await onCapture({ frontal, turned, direction: turnTo });
    } finally {
      if (streamRef.current) setPhase("ready");
    }
  }

  const TurnArrow = turnTo === "left" ? ArrowLeft : ArrowRight;
  const cameraOn = ["ready", "straight", "turn", "uploading"].includes(phase);

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl border bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn("h-full w-full -scale-x-100 object-cover", !cameraOn && "invisible")}
        />
        {cameraOn && (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-[14%] inset-y-[12%] rounded-[50%] border-4 transition-colors",
              phase === "turn" ? "border-warning" : phase === "straight" ? "border-primary" : "border-white/70"
            )}
          />
        )}
        {!cameraOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
            {phase === "starting" ? <Loader2 className="h-10 w-10 animate-spin" /> : <ScanFace className="h-12 w-12" />}
            <p className="text-sm">{phase === "starting" ? "Opening camera..." : "Your camera is used only for this scan."}</p>
          </div>
        )}
        {(phase === "straight" || phase === "turn" || phase === "uploading") && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-4 py-3 text-center text-sm font-medium text-white">
            {phase === "straight" && "Look straight at the camera and hold still"}
            {phase === "turn" && (
              <span className="inline-flex items-center gap-2">
                <TurnArrow className="h-5 w-5 animate-pulse" /> Now slowly turn your head to your {turnTo}
              </span>
            )}
            {phase === "uploading" && (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking...
              </span>
            )}
          </div>
        )}
      </div>

      {phase === "ready" && (
        <p className="text-center text-sm text-muted-foreground">
          Face the camera in good light, with only you in view. You'll be asked to turn your head to your <strong>{turnTo}</strong>.
        </p>
      )}

      {(cameraError || (phase === "ready" && error)) && <Alert>{cameraError || error}</Alert>}

      {!cameraOn ? (
        <Button type="button" size="lg" className="w-full" onClick={startCamera} disabled={phase === "starting"}>
          <Camera /> Open camera
        </Button>
      ) : (
        <Button type="button" size="lg" className="w-full" onClick={scan} disabled={phase !== "ready"}>
          <ScanFace /> {error ? "Try again" : startLabel}
        </Button>
      )}
    </div>
  );
}

// Multipart body for the face endpoints: frontal (one or more), turned, direction, plus `fields`.
export function faceFormData({ frontal, turned, direction }, fields = {}) {
  const data = new FormData();
  Object.entries(fields).forEach(([k, v]) => data.append(k, v));
  frontal.forEach((blob, i) => data.append("frontal", blob, `frontal-${i}.jpg`));
  data.append("turned", turned, "turned.jpg");
  data.append("direction", direction);
  return data;
}
