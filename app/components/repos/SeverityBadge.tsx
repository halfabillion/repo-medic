import { SEVERITY_STYLE, type Severity } from "@/lib/repo-medic";
import { cn } from "@/lib/utils";

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium leading-none",
        s.chip,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function SeverityCounts({ counts }: { counts: Record<Severity, number> }) {
  const entries = (Object.keys(SEVERITY_STYLE) as Severity[]).filter((s) => counts[s] > 0);
  if (entries.length === 0) return <span className="text-xs text-muted-foreground">No open issues</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((s) => (
        <span
          key={s}
          className={cn("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium", SEVERITY_STYLE[s].chip)}
        >
          {counts[s]} {SEVERITY_STYLE[s].label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}
