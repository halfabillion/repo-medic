import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetHeaderActions, useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconAlertTriangle, IconRadar, IconRefresh } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { FindingBoard } from "@/components/repos/FindingBoard";
import { FindingDrawer } from "@/components/repos/FindingDrawer";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEVERITY_ORDER, SEVERITY_STYLE, type Severity, type Tool, TOOL_LABEL, timeAgo } from "@/lib/repo-medic";

export function meta() {
  return [{ title: "Triage board · Repo Medic" }];
}

export default function RepoBoardRoute() {
  const { repoId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const findingId = searchParams.get("finding");
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [tool, setTool] = useState<"all" | Tool>("all");

  const repos = useActionQuery("list-repos", {});
  const repo = repos.data?.repos.find((r) => r.id === repoId);
  const list = useActionQuery("list-findings", { repoId, limit: 500 }, { enabled: Boolean(repoId) });

  const scan = useActionMutation("scan-repo", {
    onSuccess: (r) => toast.success(r.summary),
    onError: (e) => toast.error(actionErrorMessage(e) ?? "The scan failed."),
  });

  useSetPageTitle(repo?.name ?? "Triage board");
  useSetHeaderActions(
    <Button size="sm" variant="outline" disabled={scan.isPending || !repo} onClick={() => scan.mutate({ repoId })}>
      {scan.isPending ? <IconRadar className="size-4 animate-pulse" /> : <IconRefresh className="size-4" />}
      {scan.isPending ? "Scanning…" : "Scan now"}
    </Button>,
  );

  const all = list.data?.findings ?? [];
  const visible = useMemo(
    () => all.filter((f) => (severity === "all" || f.severity === severity) && (tool === "all" || f.tool === tool)),
    [all, severity, tool],
  );
  const failedTools = Object.entries(repo?.lastScan?.tools ?? {}).filter(([, t]) => !t.ok);

  function openFinding(id: string | null) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("finding", id);
    else next.delete("finding");
    setSearchParams(next, { replace: true });
  }

  if (list.error) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        {actionErrorMessage(list.error) ?? "This repository could not be loaded."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
        <div className="text-xs text-muted-foreground">
          {repo?.lastScan ? (
            <>
              Scanned {timeAgo(repo.lastScannedAt)} at <span className="font-mono">{repo.lastScan.commitSha?.slice(0, 7)}</span> ·{" "}
              {Object.entries(repo.lastScan.tools)
                .map(([name, t]) => `${name} ${t.ok ? t.findings : "failed"}`)
                .join(" · ")}
            </>
          ) : repo ? (
            "Not scanned yet — run a scan to fill the board."
          ) : null}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {SEVERITY_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {SEVERITY_STYLE[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tool} onValueChange={(v) => setTool(v as typeof tool)}>
            <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Filter by scanner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scanners</SelectItem>
              {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TOOL_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {failedTools.length ? (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs md:mx-6">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>
            {failedTools.map(([name, t]) => `${name}: ${t.error ?? "failed"}`).join(" · ")} — its findings were left as they were.
          </span>
        </div>
      ) : null}
      <FindingBoard findings={visible} loading={list.isLoading} selectedId={findingId} onOpen={openFinding} />
      <FindingDrawer findingId={findingId} onClose={() => openFinding(null)} />
    </div>
  );
}
