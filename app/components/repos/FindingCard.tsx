import { IconCircleCheck, IconCircleX, IconGitBranch, IconLoader2, IconWand } from "@tabler/icons-react";

import { type Finding, locationLabel, TOOL_SHORT } from "@/lib/repo-medic";
import { cn } from "@/lib/utils";

import { SeverityBadge } from "./SeverityBadge";

function FixBadge({ fix }: { fix: Finding["latestFix"] }) {
  if (!fix || fix.status === "discarded") return null;
  const map = {
    draft: { icon: IconLoader2, label: "Fix drafted", cls: "text-muted-foreground" },
    passed: { icon: IconCircleCheck, label: "Fix verified", cls: "text-emerald-700 dark:text-emerald-300" },
    failed: { icon: IconCircleX, label: "Fix failed", cls: "text-red-700 dark:text-red-300" },
    pr_opened: { icon: IconGitBranch, label: fix.prUrl ? "PR open" : "On branch", cls: "text-violet-700 dark:text-violet-300" },
  } as const;
  const m = map[fix.status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", m.cls)}>
      <Icon className="size-3.5" /> {m.label}
    </span>
  );
}

export function FindingCard({
  finding,
  selected,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  finding: Finding;
  selected: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const closed = finding.status === "resolved" || finding.status === "dismissed";
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      aria-label={`${finding.title}, ${finding.severity}, ${locationLabel(finding)}`}
      className={cn(
        "group w-full cursor-grab rounded-lg border bg-card p-3 text-left shadow-xs transition-[border-color,box-shadow,opacity] hover:border-foreground/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        selected && "border-primary/60 ring-1 ring-primary/40",
        closed && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <SeverityBadge severity={finding.severity} />
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {finding.autofixAvailable && !closed ? <IconWand className="size-3.5" aria-label="Autofix available" /> : null}
          {TOOL_SHORT[finding.tool]}
        </span>
      </div>
      <div className={cn("mt-2 text-sm font-medium leading-snug", finding.status === "resolved" && "line-through decoration-muted-foreground/50")}>
        {finding.title}
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{locationLabel(finding)}</div>
      {finding.status === "dismissed" && finding.dismissReason ? (
        <div className="mt-2 truncate text-[11px] text-muted-foreground">Dismissed: {finding.dismissReason}</div>
      ) : (
        <div className="mt-2 empty:hidden">
          <FixBadge fix={finding.latestFix} />
        </div>
      )}
    </button>
  );
}
