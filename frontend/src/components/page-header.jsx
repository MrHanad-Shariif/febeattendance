export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ variant = "error", children }) {
  const styles =
    variant === "success"
      ? "border-success/30 bg-success/10 text-success"
      : "border-danger/30 bg-danger/10 text-danger";
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}
