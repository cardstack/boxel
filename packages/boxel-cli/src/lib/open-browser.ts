import { spawn } from 'node:child_process';

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

// Best-effort: a detached launch whose failure is reported to the caller so it
// can fall back to printing the URL. Never rejects.
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [command, args] = browserLaunchCommand(url);

    try {
      const child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
      });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
