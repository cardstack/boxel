import { readFile } from 'node:fs/promises';

import { LINT_THREAD_HEAP_LIMIT_MB } from '@cardstack/runtime-common/tasks/lint';

// Memory held back from the workers' share of the task: the worker-manager
// itself, and the task's other containers (the log router sidecar).
export const WORKER_TASK_RESERVED_MB = 384;

// The fraction of a worker's share given to V8 old generations: the worker's
// own, and its lint thread's while a lint runs. The rest covers what a Node
// process holds outside them: young generations, compiled code and buffers.
export const WORKER_HEAP_SHARE = 0.75;

const MIN_WORKER_HEAP_MB = 256;

// The V8 old-generation limit for each worker child, so that every worker
// growing to its limit at once, each with a lint running, still fits in the
// task. Without it each child inherits the manager's heap limit, which is
// sized for the whole task; a job that grows too large then never fails
// inside its own worker. The task runs out of memory instead, stalls while
// the kernel thrashes, and its out-of-memory killer SIGKILLs whichever
// process it picks — often a worker running some other job.
export function workerHeapLimitMb(
  taskMemoryMb: number,
  workerCount: number,
): number {
  let share = (taskMemoryMb - WORKER_TASK_RESERVED_MB) / workerCount;
  return Math.max(
    MIN_WORKER_HEAP_MB,
    Math.floor(share * WORKER_HEAP_SHARE) - LINT_THREAD_HEAP_LIMIT_MB,
  );
}

// The memory limit of the task this process runs in, in MiB, or undefined
// when there is none to divide (a developer machine, CI). The deployment
// names it when it knows it (`--taskMemoryMb`); a limit set on the
// container's own cgroup covers a container run with a limit of its own.
export async function taskMemoryLimitMb(
  configuredMb: number | undefined,
): Promise<number | undefined> {
  if (configuredMb !== undefined && configuredMb > 0) {
    return configuredMb;
  }
  return await cgroupMemoryLimitMb();
}

// cgroup v2 writes `max` for no limit; cgroup v1 writes a number near 2^63.
const UNLIMITED_BYTES = 2 ** 60;

export async function cgroupMemoryLimitMb(
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<number | undefined> {
  for (let path of [
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
  ]) {
    let raw: string;
    try {
      raw = (await read(path)).trim();
    } catch {
      continue;
    }
    let bytes = Number(raw);
    if (raw === 'max' || !Number.isFinite(bytes) || bytes >= UNLIMITED_BYTES) {
      return undefined;
    }
    return Math.floor(bytes / (1024 * 1024));
  }
  return undefined;
}
