import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconGitBranch,
  IconGitPullRequest,
  IconPencil,
  IconRadar,
  IconRobot,
  IconUser,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export interface TimelineEntry {
  id: string;
  at: string;
  actor: "agent" | "human" | "system";
  actorLabel: string;
  kind: string;
  ok: boolean | null;
  summary: string;
  detail: string[];
  fixId: string | null;
}

const ACTOR_STYLE: Record<TimelineEntry["actor"], { label: string; className: string; Icon: typeof IconUser }> = {
  agent: { label: "Agent", className: "bg-violet-600/10 text-violet-700 dark:text-violet-300", Icon: IconRobot },
  human: { label: "Person", className: "bg-sky-600/10 text-sky-700 dark:text-sky-300", Icon: IconUser },
  system: { label: "System", className: "bg-muted text-muted-foreground", Icon: IconRadar },
};

function kindIcon(e: TimelineEntry) {
  if (e.ok === false) return <IconCircleX className="size-4 text-red-600" />;
  if (e.kind === "pr_opened") return <IconGitPullRequest className="size-4 text-violet-600" />;
  if (e.kind === "branch_created") return <IconGitBranch className="size-4 text-violet-600" />;
  if (e.ok === true) return <IconCircleCheck className="size-4 text-emerald-600" />;
  if (e.kind === "fix_proposed") return <IconPencil className="size-4 text-foreground" />;
  if (e.kind === "detected" || e.kind === "reopened") return <IconAlertTriangle className="size-4 text-amber-500" />;
  return <span className="block size-2 rounded-full bg-muted-foreground/60" />;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Who did what, and when: the retry story of a finding, oldest first. */
export function ActivityTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return null;
  const attempts = entries.filter((e) => e.kind === "fix_proposed" || e.kind === "fix_rejected").length;
  const failures = entries.filter((e) => e.ok === false).length;
  return (
    <section className="space-y-3" aria-label="Activity">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Activity</h3>
        <span className="text-xs text-muted-foreground">
          {attempts} fix attempt{attempts === 1 ? "" : "s"}
          {failures ? ` · ${failures} failed` : ""}
        </span>
      </div>
      <ol className="relative space-y-3 border-l pl-5">
        {entries.map((e) => {
          const actor = ACTOR_STYLE[e.actor];
          return (
            <li key={e.id} className="relative" data-testid="timeline-entry" data-kind={e.kind} data-actor={e.actor}>
              <span className="absolute -left-[29px] top-0.5 flex size-4 items-center justify-center rounded-full bg-background">
                {kindIcon(e)}
              </span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", actor.className)}>
                  <actor.Icon className="size-3" />
                  {e.actorLabel}
                </span>
                <time dateTime={e.at} className="text-muted-foreground">
                  {clock(e.at)}
                </time>
              </div>
              <p className={cn("mt-1 text-sm", e.ok === false && "text-red-700 dark:text-red-300")}>{e.summary}</p>
              {e.detail.length ? (
                <ul className="mt-1 space-y-0.5">
                  {e.detail.map((d, i) =>
                    /^https?:\/\//.test(d) ? (
                      <li key={i}>
                        <a href={d} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          {d.replace(/^https:\/\/github\.com\//, "")} <IconExternalLink className="size-3" />
                        </a>
                      </li>
                    ) : (
                      <li key={i} className="break-words text-xs text-muted-foreground">
                        {e.ok === false ? "Why: " : ""}
                        {d}
                      </li>
                    ),
                  )}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
