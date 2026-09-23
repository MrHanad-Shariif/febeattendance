import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
  purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
};

/** KPI card: icon, big number, label, optional trend chip and footnote. */
export function StatCard({ title, value, icon: Icon, tone = "primary", trend, hint, loading, index = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-20" />
            ) : (
              <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
            )}
          </div>
          {Icon && (
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
        {(trend !== undefined && trend !== null) || hint ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            {trend !== undefined && trend !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                  trend >= 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
                )}
              >
                {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(trend)}%
              </span>
            )}
            {hint && <span>{hint}</span>}
          </div>
        ) : null}
      </Card>
    </motion.div>
  );
}
