import { useEffect } from "react";
import Logo from "@/components/Logo.jsx";
import { FACULTY_NAME, formatDateTime } from "@/lib/committees";

/** Letterhead for printable minutes and reports: the existing faculty logo,
 * the faculty name, the document title and when it was generated. */
export function FebeDocumentHeader({ title, subtitle, meta = [] }) {
  return (
    <header className="border-b-2 border-emerald-700 pb-4">
      <div className="flex items-center gap-4">
        <Logo className="h-16 w-auto" />
        <div className="min-w-0">
          <p className="text-base font-bold uppercase tracking-wide text-emerald-800">{FACULTY_NAME}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
        </div>
      </div>
      {meta.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {meta.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-900">{value || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

export function FebeDocumentFooter() {
  return (
    <footer className="mt-10 border-t pt-3 text-xs text-slate-500">
      {FACULTY_NAME} · Official record · Printed {formatDateTime(new Date().toISOString())}
    </footer>
  );
}

/** Printed documents are always light, whatever theme the app uses. */
export function useLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);
}
