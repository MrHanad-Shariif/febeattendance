import { useState } from "react";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function VerifyModal({
  title,
  actionLabel,
  onCancel,
  onSubmit,
  submitting,
  error,
  showNote,
  noteLabel,
  codePlaceholder = "6-digit code from the kiosk screen",
  codeMaxLength = 8,
  helperText,
}) {
  const [code, setCode] = useState("");
  const [locationState, setLocationState] = useState("idle"); // idle | requesting | granted | denied
  const [coords, setCoords] = useState(null);
  const [note, setNote] = useState("");

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationState("denied");
      return;
    }
    setLocationState("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationState("granted");
      },
      () => setLocationState("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({ code, lat: coords?.lat ?? null, lng: coords?.lng ?? null, note: note.trim() || null });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {helperText || "Confirm you are on campus: enter the code shown on the kiosk screen and allow location access."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="campus-code">Campus code</Label>
            <Input
              id="campus-code"
              autoFocus
              inputMode="numeric"
              maxLength={codeMaxLength}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={codePlaceholder}
              className="h-11 text-lg tracking-widest"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Location</Label>
            {locationState === "idle" && (
              <Button type="button" variant="outline" className="w-full" onClick={requestLocation}>
                <MapPin /> Turn on location
              </Button>
            )}
            {locationState === "requesting" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Requesting location permission...
              </p>
            )}
            {locationState === "granted" && (
              <p className="flex items-center gap-2 text-sm font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> Location captured
              </p>
            )}
            {locationState === "denied" && (
              <div className="space-y-1">
                <p className="text-sm text-destructive">
                  Location permission was denied or unavailable. Enable location access in your browser settings.
                </p>
                <Button type="button" variant="link" className="h-auto p-0" onClick={requestLocation}>
                  Try again
                </Button>
              </div>
            )}
          </div>

          {showNote && (
            <div className="space-y-1.5">
              <Label htmlFor="note">{noteLabel || "Reason (optional)"}</Label>
              <Textarea
                id="note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Leaving early for a family emergency, approved by the dean"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if not applicable. This is recorded on your attendance and visible to admin staff.
              </p>
            </div>
          )}

          {error && <Alert>{error}</Alert>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !code || locationState !== "granted"}>
              {submitting ? "Verifying..." : actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
