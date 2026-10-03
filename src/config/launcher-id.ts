/**
 * A run id every worker of one `wdio run` derives on its own, from the launcher
 * process, so `QualflareService` is not needed for the workers to agree.
 *
 * WHY THIS EXISTS
 *
 * `qf collect` merges only the report files that share one run id. Each spec
 * file runs in its own worker process, and outside CI a worker has nothing to
 * derive a shared id from, so without help each would invent its own and the
 * upload would carry one spec file's results. The launcher service is that
 * help, but it is a second thing to configure, and WebdriverIO's setup wizard
 * (`npm init wdio`) can add a reporter without its service.
 *
 * Every worker of one run has the same launcher, though, and a process is
 * identified by its pid plus its start time (the pid alone gets reused, which
 * would merge a stale report into today's launch — exactly what the run id is
 * there to prevent). Measured on macOS, Linux and Windows with WebdriverIO 8
 * and 9: identical within a run, different across runs.
 *
 * THE ONE CASE IT CANNOT COVER: two runs started by a programmatic `Launcher`
 * inside one Node process share that process, so they derive the same id. That
 * case still needs the service, whose onComplete clears the id between runs.
 *
 * Measured details this depends on:
 * - On headless Linux, WebdriverIO 9 starts each worker inside its own
 *   `xvfb-run` (a /bin/sh script), so the worker's parent is that wrapper, not
 *   the launcher. The walk steps over it.
 * - `ps` prints `lstart` in the user's locale (a Turkish macOS printed
 *   "Cmt 3 Eki …"), so it runs under LC_ALL=C.
 * - On Windows the only practical source is PowerShell, which took ~8.7s per
 *   lookup on a GitHub runner, almost all of it start-up. It runs in the
 *   background from the reporter's constructor; see `LauncherRunId`.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

export interface ProcInfo {
  ppid: number;
  /** An opaque, stable marker of when the process started. Only equality matters. */
  start: string;
  cmd: string;
}

/** `xvfb-run` as the command, or as the script a shell is running. */
const XVFB_WRAPPER = /(^|[/\s])xvfb-run(\s|$)/;
/** A wrapper or two at most; anything deeper is not a layout we understand. */
const MAX_HOPS = 4;
const PS_TIMEOUT_MS = 5_000;
const POWERSHELL_TIMEOUT_MS = 30_000;

/** Parses /proc/<pid>/stat. The command name in parentheses may itself contain
 * spaces or ')', so fields are counted from the LAST ')'. */
export function parseLinuxStat(stat: string): { ppid: number; start: string } | undefined {
  const close = stat.lastIndexOf(')');
  if (close < 0) return undefined;
  const fields = stat.slice(close + 2).split(' ');
  // fields[0] is field 3 (state): ppid is field 4, starttime field 22.
  const ppid = Number(fields[1]);
  const start = fields[19];
  return Number.isInteger(ppid) && start ? { ppid, start } : undefined;
}

/** Parses one line of `ps -o ppid=,lstart=,command=` printed under LC_ALL=C,
 * e.g. `47675 Sat Oct  3 21:46:19 2026     /bin/zsh -c …`. */
export function parsePsLine(line: string): ProcInfo | undefined {
  const m = line.trim().match(/^(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/);
  return m ? { ppid: Number(m[1]), start: m[2]!.replace(/\s+/g, ' '), cmd: m[3]! } : undefined;
}

/** The start time PowerShell prints for one process, as an ISO-8601 string. */
export function parsePowerShellStart(out: string): string | undefined {
  const s = out.trim();
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s : undefined;
}

/** Hashes a launcher's identity into the run id. */
export function launcherRunIdFor(pid: number, start: string, host: string = hostname()): string {
  return `launch-${createHash('sha256').update(`${host}|${pid}|${start}`).digest('hex').slice(0, 32)}`;
}

/** Walks from `startPid` to the launcher, stepping over xvfb-run wrappers, and
 * returns its run id, or undefined when the process tree cannot be read. */
export function deriveLauncherRunId(
  startPid: number,
  info: (pid: number) => ProcInfo | undefined,
  host?: string,
): string | undefined {
  let pid = startPid;
  for (let hops = 0; hops < MAX_HOPS; hops += 1) {
    const p = info(pid);
    if (!p || !p.start) return undefined;
    if (XVFB_WRAPPER.test(p.cmd)) {
      pid = p.ppid;
      continue;
    }
    return launcherRunIdFor(pid, p.start, host);
  }
  return undefined;
}

function linuxInfo(pid: number): ProcInfo | undefined {
  try {
    const stat = parseLinuxStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    if (!stat) return undefined;
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
    return { ...stat, cmd };
  } catch {
    return undefined;
  }
}

function darwinInfo(pid: number): ProcInfo | undefined {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,lstart=,command=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: PS_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parsePsLine(out);
  } catch {
    return undefined;
  }
}

/** PowerShell's start time for one pid. No wrapper exists on Windows, so the
 * launcher is always the direct parent and only its start time is needed. */
function windowsArgs(pid: number): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
  ];
}

function windowsRunIdSync(pid: number): string | undefined {
  try {
    const out = execFileSync('powershell.exe', windowsArgs(pid), {
      encoding: 'utf8',
      timeout: POWERSHELL_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const start = parsePowerShellStart(out);
    return start ? launcherRunIdFor(pid, start) : undefined;
  } catch {
    return undefined;
  }
}

function windowsRunIdAsync(pid: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      windowsArgs(pid),
      { encoding: 'utf8', timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        const start = err ? undefined : parsePowerShellStart(stdout);
        resolve(start ? launcherRunIdFor(pid, start) : undefined);
      },
    );
  });
}

/**
 * The launcher-derived run id for this worker, looked up once.
 *
 * On Linux and macOS the lookup is fast (0–50ms measured) and done on
 * construction. On Windows it starts in the background on construction, and
 * `value()` returns undefined until it has settled; `wait()` resolves when it
 * has, and `valueSync()` forces a blocking lookup for when there is no time
 * left to wait.
 */
export class LauncherRunId {
  #value: string | undefined;
  #settled = false;
  #pending: Promise<void> | undefined;

  private constructor() {}

  /** Starts the lookup, or settles immediately to undefined outside a
   * WebdriverIO worker, where there is no launcher to agree on. */
  static start(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    parentPid: number = process.ppid,
  ): LauncherRunId {
    const id = new LauncherRunId();
    if (!env.WDIO_WORKER_ID) {
      id.#settled = true;
      return id;
    }
    if (platform === 'win32') {
      id.#pending = windowsRunIdAsync(parentPid).then((v) => {
        id.#value = v;
        id.#settled = true;
      });
      return id;
    }
    const info = platform === 'linux' ? linuxInfo : platform === 'darwin' ? darwinInfo : undefined;
    id.#value = info ? deriveLauncherRunId(parentPid, info) : undefined;
    id.#settled = true;
    return id;
  }

  get settled(): boolean {
    return this.#settled;
  }

  value(): string | undefined {
    return this.#value;
  }

  /** Resolves once the lookup has settled. */
  wait(): Promise<void> {
    return this.#pending ?? Promise.resolve();
  }

  /** The value, forcing a blocking lookup if the background one has not
   * finished. Windows only; elsewhere the value is already settled. */
  valueSync(parentPid: number = process.ppid): string | undefined {
    if (!this.#settled) {
      this.#value = windowsRunIdSync(parentPid);
      this.#settled = true;
    }
    return this.#value;
  }
}
