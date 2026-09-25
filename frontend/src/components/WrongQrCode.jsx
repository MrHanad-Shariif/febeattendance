import { Link } from "react-router-dom";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Shown when someone scans the other group's check-in QR code
// (a student scanning the green lecturer code, or a lecturer the blue student code).
const COPY = {
  lecturer: {
    title: "This QR code is for lecturers",
    body: "You scanned the green lecturer check-in code. Students check in with the blue student QR code in the classroom.",
  },
  student: {
    title: "This QR code is for students",
    body: "You scanned the blue student check-in code. Lecturers check in with the green lecturer QR code.",
  },
};

export default function WrongQrCode({ intendedFor }) {
  const copy = COPY[intendedFor];
  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardContent className="space-y-4 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-warning">
            <QrCode className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
          <p className="text-sm text-muted-foreground">You have not been checked in.</p>
          <Button asChild>
            <Link to="/">Go to my dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
