import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { isProcessAlive } from './watch-lock';

export interface RegisteredProcess {
  pid: number;
  workspace: string;
  startedAt: string;
}

interface Registry {
  processes: RegisteredProcess[];
}

function registryDir(): string {
  return path.join(os.homedir(), '.boxel-cli');
}

function registryFile(): string {
  return path.join(registryDir(), 'watch-processes.json');
}

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await fs.readFile(registryFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Registry>;
    if (!Array.isArray(parsed?.processes)) {
      return { processes: [] };
    }
    const processes = parsed.processes.filter(
      (entry): entry is RegisteredProcess =>
        typeof entry?.pid === 'number' &&
        typeof entry?.workspace === 'string' &&
        typeof entry?.startedAt === 'string',
    );
    return { processes };
  } catch {
    return { processes: [] };
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  const target = registryFile();
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(registry, null, 2) + '\n');
  await fs.rename(tmp, target);
}

async function pruneDead(): Promise<Registry> {
  const registry = await readRegistry();
  const alive = registry.processes.filter((entry) => isProcessAlive(entry.pid));
  if (alive.length !== registry.processes.length) {
    await writeRegistry({ processes: alive });
  }
  return { processes: alive };
}

export async function registerProcess(workspace: string): Promise<void> {
  const registry = await pruneDead();
  const withoutCurrent = registry.processes.filter(
    (entry) => entry.pid !== process.pid,
  );
  withoutCurrent.push({
    pid: process.pid,
    workspace,
    startedAt: new Date().toISOString(),
  });
  await writeRegistry({ processes: withoutCurrent });
}

export async function unregisterCurrentProcess(): Promise<void> {
  const registry = await readRegistry();
  const next = registry.processes.filter((entry) => entry.pid !== process.pid);
  if (next.length === registry.processes.length) {
    return;
  }
  await writeRegistry({ processes: next });
}

export async function listRegisteredProcesses(): Promise<RegisteredProcess[]> {
  const registry = await pruneDead();
  return registry.processes;
}
