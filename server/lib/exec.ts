import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { config } from "./config.js";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  /** Extra environment variables. The parent environment is NOT inherited. */
  env?: Record<string, string>;
  maxBuffer?: number;
}

/**
 * Directories where Repo Medic looks for scanner binaries, in addition to PATH.
 * Scanners are installed per-user (~/.local/bin) on the dev box.
 */
export function toolPath(): string {
  const extra = [
    config.toolsDir,
    path.join(os.homedir(), ".local", "bin"),
  ].filter(Boolean) as string[];
  return [...extra, config.path ?? "/usr/local/bin:/usr/bin:/bin"].join(
    path.delimiter,
  );
}

/**
 * Run a program without a shell, with a scrubbed environment and a hard timeout.
 * Never pass user input through a shell: arguments are an array.
 * The child does not inherit API keys or tokens from the server process.
 */
export function run(
  file: string,
  args: string[],
  opts: RunOptions,
): Promise<RunResult> {
  const started = Date.now();
  const env: Record<string, string> = {
    PATH: toolPath(),
    HOME: config.home ?? os.homedir(),
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    SEMGREP_SEND_METRICS: "off",
    ...opts.env,
  };
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        env,
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
        const timedOut = Boolean(err?.killed);
        let code: number | null = 0;
        if (err) code = typeof err.code === "number" ? err.code : null;
        resolve({
          code,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? "") || (err && code === null ? String(err.message) : ""),
          timedOut,
          durationMs: Date.now() - started,
        });
      },
    );
  });
}

/** Trim long tool output for storage/UI, keeping the head and the tail. */
export function clip(text: string, max = 12_000): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n… [${text.length - max} characters trimmed] …\n${text.slice(-half)}`;
}
