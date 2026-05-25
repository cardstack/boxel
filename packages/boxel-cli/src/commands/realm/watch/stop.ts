import { execSync } from 'child_process';
import type { Command } from 'commander';
import { listRegisteredProcesses } from '../../../lib/watch-process-registry';
import { DIM, FG_GREEN, FG_RED, RESET } from '../../../lib/colors';

export interface StoppedProcess {
  pid: number;
  workspace: string;
}

export interface StopResult {
  stopped: StoppedProcess[];
  failed: StoppedProcess[];
}

const SETTLE_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalProcess(pid: number): { ok: boolean; alreadyGone: boolean } {
  try {
    if (process.platform === 'win32') {
      try {
        process.kill(pid);
      } catch {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      }
    } else {
      process.kill(pid, 'SIGINT');
    }
    return { ok: true, alreadyGone: false };
  } catch (err: any) {
    if (err?.code === 'ESRCH') {
      return { ok: true, alreadyGone: true };
    }
    return { ok: false, alreadyGone: false };
  }
}

interface PsHit {
  pid: number;
  workspace: string;
}

function findViaProcessTable(): PsHit[] {
  if (process.platform === 'win32') return [];
  let output: string;
  try {
    output = execSync(
      'ps aux | grep -E "(tsx[[:space:]].*src/index\\.ts[[:space:]]+realm[[:space:]]+watch[[:space:]]+start|[[:space:]]boxel[[:space:]]+realm[[:space:]]+watch[[:space:]]+start|node[[:space:]].*boxel[[:space:]]+realm[[:space:]]+watch[[:space:]]+start)" | grep -v grep | grep -v "[[:space:]]stop"',
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return [];
  }
  if (!output) return [];

  const hits: PsHit[] = [];
  const seen = new Set<number>();
  for (const line of output.split('\n')) {
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(pid) || seen.has(pid)) continue;
    seen.add(pid);

    let workspace = '.';
    const match = line.match(/\bstart\s+\S+\s+(\S+)/);
    if (match && match[1] && !match[1].startsWith('-')) {
      workspace = match[1];
    }
    hits.push({ pid, workspace });
  }
  return hits;
}

export async function stopWatchProcesses(): Promise<StopResult> {
  const stopped: StoppedProcess[] = [];
  const failed: StoppedProcess[] = [];
  const targetedPids = new Set<number>();

  const registered = await listRegisteredProcesses();
  for (const proc of registered) {
    if (proc.pid === process.pid) continue;
    targetedPids.add(proc.pid);
    const result = signalProcess(proc.pid);
    const record: StoppedProcess = { pid: proc.pid, workspace: proc.workspace };
    if (result.ok) {
      stopped.push(record);
    } else {
      failed.push(record);
    }
  }

  for (const hit of findViaProcessTable()) {
    if (hit.pid === process.pid) continue;
    if (targetedPids.has(hit.pid)) continue;
    targetedPids.add(hit.pid);
    const result = signalProcess(hit.pid);
    const record: StoppedProcess = { pid: hit.pid, workspace: hit.workspace };
    if (result.ok) {
      stopped.push(record);
    } else {
      failed.push(record);
    }
  }

  if (stopped.length > 0) {
    await sleep(SETTLE_MS);
    // Trigger another prune so the registry doesn't keep stale entries
    // for processes that exited cleanly above.
    await listRegisteredProcesses();
  }

  return { stopped, failed };
}

function printResult(result: StopResult): void {
  if (result.stopped.length === 0 && result.failed.length === 0) {
    console.log('No running watch processes found.');
    return;
  }
  for (const proc of result.stopped) {
    console.log(
      `  ${DIM}⇅${RESET} Stopped: boxel realm watch ${proc.workspace} (PID ${proc.pid})`,
    );
  }
  for (const proc of result.failed) {
    console.log(
      `  ${FG_RED}×${RESET} Failed to stop: boxel realm watch ${proc.workspace} (PID ${proc.pid})`,
    );
  }
  if (result.stopped.length > 0) {
    const plural = result.stopped.length > 1 ? 'es' : '';
    console.log(
      `\n${FG_GREEN}✓ Stopped ${result.stopped.length} process${plural}${RESET}`,
    );
  }
}

export function registerStopCommand(watch: Command): void {
  watch
    .command('stop')
    .description('Stop all running boxel realm watch processes')
    .action(async () => {
      const result = await stopWatchProcesses();
      printResult(result);
    });
}
