import { cn } from "@/lib/utils";

/** Read-only unified diff with per-line colouring. */
export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-muted/30", className)}>
      <pre className="max-h-[360px] overflow-auto py-2 font-mono text-[12px] leading-5">
        {lines.map((line, i) => {
          const kind = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")
            ? "meta"
            : line.startsWith("@@")
              ? "hunk"
              : line.startsWith("+")
                ? "add"
                : line.startsWith("-")
                  ? "del"
                  : "ctx";
          if (kind === "meta" && !line.startsWith("+++")) return null;
          return (
            <div
              key={i}
              className={cn(
                "whitespace-pre px-3",
                kind === "add" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                kind === "del" && "bg-red-500/10 text-red-800 dark:text-red-300",
                kind === "hunk" && "text-muted-foreground",
                kind === "meta" && "pb-1 font-semibold text-foreground",
              )}
            >
              {kind === "meta" ? line.replace(/^\+\+\+ b\//, "") : line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** Source excerpt with line numbers; highlighted lines mark the finding. */
export function CodeExcerpt({
  startLine,
  lines,
  highlightFrom,
  highlightTo,
}: {
  startLine: number;
  lines: string[];
  highlightFrom: number | null;
  highlightTo: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <pre className="max-h-[300px] overflow-auto py-2 font-mono text-[12px] leading-5">
        {lines.map((line, i) => {
          const n = startLine + i;
          const hot = highlightFrom !== null && n >= highlightFrom && n <= (highlightTo ?? highlightFrom);
          return (
            <div key={n} className={cn("flex whitespace-pre", hot && "bg-amber-400/15")}>
              <span
                className={cn(
                  "w-10 shrink-0 select-none pr-3 text-right text-muted-foreground/70",
                  hot && "font-semibold text-amber-700 dark:text-amber-300",
                )}
              >
                {n}
              </span>
              <span className="pr-3">{line || " "}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
