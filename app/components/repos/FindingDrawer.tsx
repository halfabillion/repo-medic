import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconGitBranch,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconRotateClockwise,
  IconSparkles,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { advisoryUrl, askAgentToFix, type Finding, type Fix, locationLabel, TOOL_LABEL, timeAgo } from "@/lib/repo-medic";
import { cn } from "@/lib/utils";

import { CodeExcerpt, DiffView } from "./DiffView";
import { DismissDialog } from "./DismissDialog";
import { SeverityBadge } from "./SeverityBadge";

const CHECK_LABEL: Record<string, string> = {
  patch_applies: "Patch applies",
  tests: "Project tests",
  finding_gone: "Finding gone on re-scan",
  no_new_issues: "No new issues",
};

const FIX_STATUS: Record<Fix["status"], { label: string; className: string }> = {
  draft: { label: "Not verified yet", className: "text-muted-foreground" },
  passed: { label: "Verified", className: "text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Failed checks", className: "text-red-700 dark:text-red-300" },
  pr_opened: { label: "Shipped", className: "text-violet-700 dark:text-violet-300" },
  discarded: { label: "Superseded", className: "text-muted-foreground" },
};

const SOURCE_LABEL: Record<Fix["source"], string> = {
  autofix: "Deterministic autofix",
  agent: "Written by the agent",
  human: "Submitted by a person",
};

export function FindingDrawer({
  findingId,
  onClose,
}: {
  findingId: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(findingId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px]">
        {findingId ? <FindingDetail findingId={findingId} onHandOff={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/** onHandOff closes the drawer so the agent panel (also on the right) is visible. */
function FindingDetail({ findingId, onHandOff }: { findingId: string; onHandOff: () => void }) {
  const { data, isLoading, error } = useActionQuery("get-finding", { id: findingId });
  const [dismissOpen, setDismissOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [phase, setPhase] = useState<null | "patch" | "verify">(null);

  const update = useActionMutation("update-finding", {
    onError: (e) => toast.error(actionErrorMessage(e) ?? "Could not update the finding."),
  });
  const propose = useActionMutation("propose-fix");
  const test = useActionMutation("test-fix");
  const openPr = useActionMutation("open-pull-request", {
    onSuccess: (r) => toast.success(r.message),
    onError: (e) => toast.error(actionErrorMessage(e) ?? "Could not create the branch."),
  });

  if (isLoading) return <DetailSkeleton />;
  if (error || !data) {
    return (
      <div className="p-6">
        <SheetTitle>Finding unavailable</SheetTitle>
        <SheetDescription className="mt-2">
          {actionErrorMessage(error) ?? "It may have been removed, or you no longer have access."}
        </SheetDescription>
      </div>
    );
  }

  const { finding: f, code, fixes, repoName } = data;
  const latest = fixes[0] ?? null;
  const open = f.status === "new" || f.status === "confirmed" || f.status === "fix_ready";
  const busy = phase !== null || update.isPending || openPr.isPending;

  async function verify(fixId: string) {
    setPhase("verify");
    try {
      const r = await test.mutateAsync({ id: fixId });
      if (r.passed) toast.success("Fix verified: tests pass and the finding is gone.");
      else toast.error(`Fix failed: ${r.checks.filter((c) => !c.ok).map((c) => CHECK_LABEL[c.id] ?? c.id).join(", ")}`);
    } catch (e) {
      toast.error(actionErrorMessage(e) ?? "Verification could not run.");
    } finally {
      setPhase(null);
    }
  }

  async function autofix() {
    setPhase("patch");
    try {
      const r = await propose.mutateAsync({ findingId: f.id });
      await verify(r.id);
    } catch (e) {
      toast.error(actionErrorMessage(e) ?? "No automatic fix for this one.");
      setPhase(null);
    }
  }

  function askAgent() {
    const { message, context } = askAgentToFix(f, repoName);
    sendToAgentChat({ message, context, submit: true, openSidebar: true });
    toast("Sent to the agent. Follow along in the chat panel.");
    onHandOff();
  }

  return (
    <>
      <div className="border-b px-6 pb-4 pt-5">
        <div className="flex items-center gap-2 pr-8">
          <SeverityBadge severity={f.severity} />
          <span className="text-xs text-muted-foreground">{TOOL_LABEL[f.tool]}</span>
          {f.cwe ? <span className="text-xs text-muted-foreground">· {f.cwe}</span> : null}
        </div>
        <SheetTitle className="mt-2 text-lg leading-snug">{f.title}</SheetTitle>
        <SheetDescription className="mt-1 font-mono text-xs">{locationLabel(f)}</SheetDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          {f.status === "new" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => update.mutate({ id: f.id, status: "confirmed" })}>
              <IconCheck className="size-4" /> Confirm
            </Button>
          ) : null}
          {open && f.autofixAvailable ? (
            <Button size="sm" disabled={busy} onClick={() => void autofix()}>
              <IconWand className="size-4" />
              {phase === "patch" ? "Writing patch…" : phase === "verify" ? "Running checks…" : "Auto-fix & verify"}
            </Button>
          ) : null}
          {open ? (
            <Button size="sm" variant={f.autofixAvailable ? "outline" : "default"} disabled={busy} onClick={askAgent}>
              <IconSparkles className="size-4" /> Ask agent to fix
            </Button>
          ) : null}
          {f.status === "new" || f.status === "confirmed" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDismissOpen(true)}>
              <IconX className="size-4" /> Dismiss
            </Button>
          ) : null}
          {f.status === "dismissed" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => update.mutate({ id: f.id, status: "new" })}>
              <IconRotateClockwise className="size-4" /> Reopen
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {f.status === "dismissed" && f.dismissReason ? (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">Dismissed:</span> {f.dismissReason}
          </p>
        ) : null}
        {f.status === "resolved" ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-sm">
            <IconCircleCheck className="size-4 text-emerald-600" /> The latest scan no longer reports this.
          </p>
        ) : null}

        <section className="space-y-2">
          <p className="text-sm leading-relaxed">{f.message}</p>
          {f.tool === "gitleaks" ? (
            <p className="flex gap-2 text-sm text-muted-foreground">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              Removing it from the code is not enough: rotate the key with the provider, because it stays in git history.
            </p>
          ) : null}
        </section>

        {code ? (
          <CodeExcerpt startLine={code.startLine} lines={code.lines} highlightFrom={f.startLine} highlightTo={f.endLine} />
        ) : f.snippet ? (
          <pre className="overflow-auto rounded-lg border bg-muted/30 px-3 py-2 font-mono text-[12px]">{f.snippet}</pre>
        ) : null}

        {f.packageName ? (
          <section className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{f.packageName}</span>
              <span className="text-muted-foreground">{f.packageVersion}</span>
              {f.fixedVersion ? (
                <>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-emerald-700 dark:text-emerald-300">≥ {f.fixedVersion}</span>
                </>
              ) : (
                <span className="text-muted-foreground">no fixed release yet</span>
              )}
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {f.advisories.slice(0, 12).map((a) => {
                const url = advisoryUrl(a);
                return (
                  <li key={a}>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        {a} <IconExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs">{a}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {latest ? (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Proposed fix</h3>
              <span className={cn("text-xs font-medium", FIX_STATUS[latest.status].className)}>
                {FIX_STATUS[latest.status].label}
              </span>
            </div>
            <p className="text-sm">{latest.summary}</p>
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABEL[latest.source]} · base {latest.baseCommit.slice(0, 7)} · {timeAgo(latest.updatedAt)}
            </p>
            {latest.checks.length ? (
              <ul className="divide-y rounded-lg border">
                {latest.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                    {c.skipped ? (
                      <IconPlayerSkipForward className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : c.ok ? (
                      <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <IconCircleX className="mt-0.5 size-4 shrink-0 text-red-600" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium">{CHECK_LABEL[c.id] ?? c.id}</div>
                      <div className="break-words text-xs text-muted-foreground">{c.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <DiffView diff={latest.diff} />
            {latest.testOutput ? (
              <details className="rounded-lg border">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">Test output</summary>
                <pre className="max-h-64 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-4">{latest.testOutput}</pre>
              </details>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {latest.status === "draft" || latest.status === "failed" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void verify(latest.id)}>
                  <IconPlayerPlay className="size-4" /> {phase === "verify" ? "Running checks…" : "Run checks"}
                </Button>
              ) : null}
              {latest.status === "passed" ? (
                <Button size="sm" disabled={busy} onClick={() => setPrOpen(true)}>
                  <IconGitBranch className="size-4" /> {openPr.isPending ? "Creating branch…" : "Create branch / PR"}
                </Button>
              ) : null}
              {latest.status === "pr_opened" ? (
                latest.prUrl ? (
                  <a href={latest.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Open pull request <IconExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <IconGitBranch className="size-3.5" /> {latest.branch}
                  </span>
                )
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <DismissDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        title={f.title}
        onConfirm={(reason) => update.mutate({ id: f.id, status: "dismissed", dismissReason: reason })}
      />
      <AlertDialog open={prOpen} onOpenChange={setPrOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Commit this fix to a new branch?</AlertDialogTitle>
            <AlertDialogDescription>
              Repo Medic commits the verified patch to a new <span className="font-mono">repo-medic/…</span> branch in {repoName}. It opens a
              pull request only when pushing is enabled for this repository's owner; otherwise nothing leaves this machine.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => latest && openPr.mutate({ id: latest.id })}>Create branch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <SheetTitle className="sr-only">Loading finding</SheetTitle>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
