import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, MapPin, QrCode, ShieldCheck } from "lucide-react";
import Logo from "@/components/Logo.jsx";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";

const POINTS = [
  { icon: QrCode, text: "Check in by scanning a printed QR code" },
  { icon: ShieldCheck, text: "Rotating campus code stops proxy check-ins" },
  { icon: MapPin, text: "Location verified on campus" },
];

/** Split-screen layout shared by every signed-out page: green brand panel + form card. */
export function AuthLayout({ title, subtitle, children, footer, wide = false }) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/5" />

        <div className="relative flex items-center gap-3">
          <div className="rounded-xl bg-white p-2 shadow-lg">
            <Logo className="h-10 w-auto" />
          </div>
          <span className="text-lg font-semibold">FEBE Attendance</span>
        </div>

        <div className="relative space-y-6">
          <h2 className="max-w-md text-4xl font-bold leading-tight">Attendance, verified and effortless.</h2>
          <ul className="space-y-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-brand-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-brand-200/80">Faculty lecturer &amp; student attendance portal</p>
      </div>

      <div className="relative flex items-center justify-center px-4 py-10">
        <ThemeToggle className="absolute right-4 top-4" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={wide ? "w-full max-w-md" : "w-full max-w-sm"}
        >
          <div className="mb-8 flex flex-col items-center gap-2 text-center lg:items-start lg:text-left">
            <Logo className="h-16 w-auto lg:hidden" />
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
          {footer && <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground lg:text-left">{footer}</div>}
        </motion.div>
      </div>
    </div>
  );
}

export function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} className="pr-10" {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
