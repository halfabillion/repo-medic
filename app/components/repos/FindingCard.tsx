import { IconArrowsMove, IconCircleCheck, IconCircleX, IconGitBranch, IconLoader2, IconSparkles, IconWand } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { agentStillWorking, useAgentAskedAt } from "@/lib/agent-requests";
import { BOARD_COLUMNS, type BoardColumn, type Finding, locationLabel, TOOL_SHORT } from "@/lib/repo-medic";
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
  onMove,
  onDragStart,
  onDragEnd,
}: {
  finding: Finding;
  selected: boolean;
  onOpen: () => void;
  /** Keyboard / pointer alternative to dragging; goes through the board's guarded move. */
  onMove: (column: BoardColumn) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const closed = finding.status === "resolved" || finding.status === "dismissed";
  const askedAt = useAgentAskedAt(finding.id);
  const working = agentStillWorking(askedAt, finding.latestFix);
  const here = BOARD_COLUMNS.find((c) => c.statuses.includes(finding.status));
  return (
    <div className="relative">
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
      <div className="mt-1 truncate pr-6 font-mono text-[11px] text-muted-foreground">{locationLabel(finding)}</div>
      {finding.status === "dismissed" && finding.dismissReason ? (
        <div className="mt-2 truncate text-[11px] text-muted-foreground">Dismissed: {finding.dismissReason}</div>
      ) : (
        <div className="mt-2 empty:hidden">
          {working ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary" role="status">
              <IconSparkles className="size-3.5 animate-pulse" /> Agent working…
            </span>
          ) : (
            <FixBadge fix={finding.latestFix} />
          )}
        </div>
      )}
    </button>
    {/* Non-modal, and the move runs after the menu has closed: a dialog opened from a modal menu
        item leaves pointer-events: none on <body> (Radix). */}
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Move "${finding.title}" to…`}
        title="Move to…"
        data-move-menu={finding.id}
        className="absolute bottom-2 right-2 rounded-md p-1 text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:opacity-100"
      >
        <IconArrowsMove className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Move to…</DropdownMenuLabel>
        {BOARD_COLUMNS.filter((c) => c.id !== here?.id).map((c) => (
          <DropdownMenuItem key={c.id} data-move-to={c.id} onSelect={() => window.setTimeout(() => onMove(c), 0)}>
            {c.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  );
}
