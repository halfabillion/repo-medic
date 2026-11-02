import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconChevronRight, IconFolderPlus, IconLoader2, IconRadar, IconShieldCheck } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { SeverityCounts } from "@/components/repos/SeverityBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/repo-medic";

export function meta() {
  return [{ title: "Repositories · Repo Medic" }];
}

export default function ReposRoute() {
  useSetPageTitle("Repositories");
  const navigate = useNavigate();
  const { data, isLoading } = useActionQuery("list-repos", {});
  const [source, setSource] = useState("");
  const [scanning, setScanning] = useState<string | null>(null);

  const add = useActionMutation("add-repo");
  const scan = useActionMutation("scan-repo");

  async function addAndScan(e: React.FormEvent) {
    e.preventDefault();
    const value = source.trim();
    if (!value) return;
    try {
      const r = await add.mutateAsync({ source: value });
      setSource("");
      setScanning(r.id);
      navigate(`/repos/${r.id}`);
      const s = await scan.mutateAsync({ repoId: r.id });
      toast.success(s.summary);
    } catch (err) {
      toast.error(actionErrorMessage(err) ?? "Could not add that repository.");
    } finally {
      setScanning(null);
    }
  }

  const repos = data?.repos ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
      <form onSubmit={addAndScan} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="https://github.com/owner/repo or /path/to/local/checkout"
          aria-label="Repository URL or local path"
          className="h-10 font-mono text-sm"
        />
        <Button type="submit" className="h-10 shrink-0" disabled={!source.trim() || add.isPending}>
          {add.isPending ? <IconLoader2 className="size-4 animate-spin" /> : <IconFolderPlus className="size-4" />}
          Add & scan
        </Button>
      </form>

      <div className="mt-8 space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-[88px] w-full rounded-xl" />
            <Skeleton className="h-[88px] w-full rounded-xl" />
          </>
        ) : repos.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
            <IconShieldCheck className="size-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">No repositories yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Add one above. Repo Medic scans code, secrets and dependencies, then helps you fix and verify each issue.
            </p>
          </div>
        ) : (
          repos.map((r) => (
            <Link
              key={r.id}
              to={`/repos/${r.id}`}
              className="group flex items-center gap-4 rounded-xl border bg-card px-5 py-4 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.sourceKind === "github" ? "GitHub" : "Local"}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{r.source}</div>
                <div className="mt-2">
                  {r.lastScan ? <SeverityCounts counts={r.open} /> : <span className="text-xs text-muted-foreground">Not scanned yet</span>}
                </div>
              </div>
              <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                {scanning === r.id || r.lastScan?.status === "running" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <IconRadar className="size-3.5 animate-pulse" /> Scanning…
                  </span>
                ) : (
                  <>
                    <div>Scanned {timeAgo(r.lastScannedAt)}</div>
                    {r.lastScan?.commitSha ? <div className="font-mono">{r.lastScan.commitSha.slice(0, 7)}</div> : null}
                  </>
                )}
              </div>
              <IconChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
