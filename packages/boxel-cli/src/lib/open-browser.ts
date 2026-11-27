import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

// The platform launcher invocation for a URL. Exported for unit testing.
export function browserLaunchCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [command: string, args: string[]] {
  if (platform === 'darwin') {
    return ['open', [url]];
  }
  if (platform === 'win32') {
    // cmd.exe parses the `start` line itself, so shell metacharacters inside
    // the URL — `&` between query params, redirection chars — would cut the
    // command short and run the remainder as a separate command.
    // Caret-escaping neutralizes them; `^` is escaped first so the carets
    // this inserts aren't themselves re-escaped.
    let escaped = url.replace(/\^/g, '^^').replace(/[&|<>]/g, '^$&');
    return ['cmd', ['/c', 'start', '', escaped]];
  }
  return ['xdg-open', [url]];
}

// How long a launcher that is still running gets to fail before the browser
// counts as opened. `open` and `start` return at once; `xdg-open` returns once
// it has handed the URL on, or, when it runs the browser itself, not until the
// browser closes.
export const LAUNCH_GRACE_MS = 1500;

type Spawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

// Best-effort: a detached launch whose failure is reported to the caller so it
// can fall back to printing the URL. A launcher that exits with an error soon
// after starting, such as `xdg-open` with no browser to hand the URL to, is a
// failure too. Never rejects.
export function openBrowser(
  url: string,
  {
    spawnFn = spawn,
    graceMs = LAUNCH_GRACE_MS,
  }: { spawnFn?: Spawn; graceMs?: number } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const [command, args] = browserLaunchCommand(url);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (opened: boolean) => {
      clearTimeout(timer);
      resolve(opened);
    };

    try {
      const child = spawnFn(command, args, {
        stdio: 'ignore',
        detached: true,
      });
      child.once('error', () => settle(false));
      child.once('exit', (code) => settle(code === 0));
      child.once('spawn', () => {
        // The timer, not the launcher, keeps the CLI waiting.
        child.unref();
        timer = setTimeout(() => settle(true), graceMs);
      });
    } catch {
      settle(false);
    }
  });
}
