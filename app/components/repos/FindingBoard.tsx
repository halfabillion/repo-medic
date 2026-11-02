import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { BOARD_COLUMNS, type BoardColumn, EARNED_COLUMN_MESSAGE, type Finding } from "@/lib/repo-medic";
import { cn } from "@/lib/utils";

import { DismissDialog } from "./DismissDialog";
import { FindingCard } from "./FindingCard";

type ListData = { findings: Finding[]; total: number };

export function FindingBoard({
  findings,
  loading,
  selectedId,
  onOpen,
}: {
  findings: Finding[];
  loading: boolean;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [pendingDismiss, setPendingDismiss] = useState<Finding | null>(null);

  // Snapshot for rolling back an optimistic move.
  const snapshot = useRef<Array<[readonly unknown[], ListData | undefined]>>([]);
  const update = useActionMutation("update-finding", {
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["action", "list-findings"] });
      snapshot.current = qc.getQueriesData<ListData>({ queryKey: ["action", "list-findings"] });
      qc.setQueriesData<ListData>({ queryKey: ["action", "list-findings"] }, (old) =>
        old
          ? {
              ...old,
              findings: old.findings.map((f) =>
                f.id === vars.id
                  ? {
                      ...f,
                      ...(vars.status ? { status: vars.status } : {}),
                      ...(vars.status === "dismissed" ? { dismissReason: vars.dismissReason ?? null } : {}),
                    }
                  : f,
              ),
            }
          : old,
      );
    },
    onError: (error) => {
      snapshot.current.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(actionErrorMessage(error) ?? "Could not move the card.");
    },
  });

  const byColumn = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const col of BOARD_COLUMNS) map.set(col.id, []);
    for (const f of findings) {
      const col = BOARD_COLUMNS.find((c) => c.statuses.includes(f.status));
      if (col) map.get(col.id)!.push(f);
    }
    return map;
  }, [findings]);

  function drop(col: BoardColumn) {
    setOverColumn(null);
    const f = findings.find((x) => x.id === dragId);
    setDragId(null);
    if (!f || col.statuses.includes(f.status)) return;
    if (!col.dropStatus) {
      toast(EARNED_COLUMN_MESSAGE[col.id] ?? "Cards can't be dragged here.");
      return;
    }
    if (f.status === "fix_ready" || f.status === "pr_opened" || f.status === "resolved") {
      if (col.dropStatus !== "dismissed") {
        toast("This card's position comes from its fix or the latest scan.");
        return;
      }
    }
    if (col.dropStatus === "dismissed") {
      setPendingDismiss(f);
      return;
    }
    update.mutate({ id: f.id, status: col.dropStatus });
  }

  return (
    <>
      <div className="grid min-h-0 flex-1 auto-cols-[minmax(208px,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-4 md:px-6">
        {BOARD_COLUMNS.map((col) => {
          const cards = byColumn.get(col.id) ?? [];
          const droppable = col.dropStatus !== null;
          return (
            <section
              key={col.id}
              aria-label={col.title}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = droppable ? "move" : "none";
                setOverColumn(col.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(col);
              }}
              className={cn(
                "flex min-h-0 flex-col rounded-xl border border-transparent bg-muted/40 transition-colors",
                overColumn === col.id && droppable && "border-primary/40 bg-primary/5",
                overColumn === col.id && !droppable && "border-dashed border-muted-foreground/30",
              )}
            >
              <header className="flex items-center justify-between px-3 pb-2 pt-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{col.title}</h2>
                <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {loading ? "–" : cards.length}
                </span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {loading ? (
                  <>
                    <Skeleton className="h-[92px] w-full rounded-lg" />
                    <Skeleton className="h-[92px] w-full rounded-lg" />
                  </>
                ) : cards.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">{col.emptyHint}</p>
                ) : (
                  cards.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      selected={selectedId === f.id}
                      onOpen={() => onOpen(f.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", f.id);
                        setDragId(f.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverColumn(null);
                      }}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
      <DismissDialog
        open={Boolean(pendingDismiss)}
        onOpenChange={(open) => !open && setPendingDismiss(null)}
        title={pendingDismiss?.title ?? ""}
        onConfirm={(reason) => {
          if (pendingDismiss) update.mutate({ id: pendingDismiss.id, status: "dismissed", dismissReason: reason });
          setPendingDismiss(null);
        }}
      />
    </>
  );
}
