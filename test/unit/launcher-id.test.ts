import { describe, expect, it } from 'vitest';

import {
  LauncherRunId,
  deriveLauncherRunId,
  launcherRunIdFor,
  parseLinuxStat,
  parsePowerShellStart,
  parsePsLine,
  type ProcInfo,
} from '../../src/config/launcher-id.js';

describe('parseLinuxStat', () => {
  it('reads ppid and starttime, counting from the last parenthesis', () => {
    // A command name containing ") " must not shift the fields.
    const stat = '4242 (node) evil) S 4100 4242 4100 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 11 0 987654 0 0';
    expect(parseLinuxStat(stat)).toEqual({ ppid: 4100, start: '987654' });
  });

  it('rejects what it cannot read', () => {
    expect(parseLinuxStat('garbage')).toBeUndefined();
  });
});

describe('parsePsLine', () => {
  it('reads a C-locale lstart, normalising its padding', () => {
    expect(parsePsLine('47675 Sat Oct  3 21:46:19 2026     /bin/zsh -c x')).toEqual({
      ppid: 47675,
      start: 'Sat Oct 3 21:46:19 2026',
      cmd: '/bin/zsh -c x',
    });
  });

  // Measured on a Turkish macOS without LC_ALL=C. darwinInfo forces the C
  // locale for exactly this reason; a localized line is never guessed at.
  it('rejects a localized lstart', () => {
    expect(parsePsLine('47675 Cmt 3 Eki 21:46:10 2026 /bin/zsh')).toBeUndefined();
  });
});

describe('parsePowerShellStart', () => {
  it('accepts an ISO-8601 start time and nothing else', () => {
    expect(parsePowerShellStart('2026-10-03T18:47:52.3672028Z\r\n')).toBe('2026-10-03T18:47:52.3672028Z');
    expect(parsePowerShellStart('Get-Process : Cannot find a process')).toBeUndefined();
  });
});

describe('deriveLauncherRunId', () => {
  const tree: Record<number, ProcInfo> = {
    // A worker's parent on headless Linux under WebdriverIO 9: its own wrapper.
    300: { ppid: 200, start: '901', cmd: '/bin/sh /usr/bin/xvfb-run --auto-servernum -- node run.js' },
    200: { ppid: 100, start: '900', cmd: 'node node_modules/.bin/wdio run wdio.conf.js' },
  };
  const info = (pid: number) => tree[pid];

  it('steps over xvfb-run to the launcher', () => {
    expect(deriveLauncherRunId(300, info, 'host')).toBe(launcherRunIdFor(200, '900', 'host'));
  });

  it('uses the direct parent when nothing wraps the worker', () => {
    expect(deriveLauncherRunId(200, info, 'host')).toBe(launcherRunIdFor(200, '900', 'host'));
  });

  it('gives up rather than guess when the tree cannot be read', () => {
    expect(deriveLauncherRunId(999, info, 'host')).toBeUndefined();
    const endless = (pid: number): ProcInfo => ({ ppid: pid + 1, start: 's', cmd: 'xvfb-run' });
    expect(deriveLauncherRunId(1, endless, 'host')).toBeUndefined();
  });

  // The pid alone gets reused. A recycled pid with a different start time is a
  // different run, or a stale report would be merged into today's launch.
  it('separates a reused pid by its start time', () => {
    expect(launcherRunIdFor(200, '900', 'h')).not.toBe(launcherRunIdFor(200, '901', 'h'));
  });
});

describe('LauncherRunId', () => {
  it('stays out of the way outside a WebdriverIO worker', () => {
    const id = LauncherRunId.start({}, 'linux', 1);
    expect(id.settled).toBe(true);
    expect(id.value()).toBeUndefined();
  });

  it('derives a stable id for this process\'s parent', () => {
    if (process.platform === 'win32') return; // PowerShell path: covered in CI integration.
    const a = LauncherRunId.start({ WDIO_WORKER_ID: '0-0' });
    const b = LauncherRunId.start({ WDIO_WORKER_ID: '0-1' });
    expect(a.value()).toMatch(/^launch-[0-9a-f]{32}$/);
    expect(b.value()).toBe(a.value());
  });
});
