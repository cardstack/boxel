import { spawn } from 'node:child_process';

// Best-effort: a detached launch whose failure is reported to the caller so it
// can fall back to printing the URL. Never rejects.
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [command, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]];

    try {
      const child = spawn(command as string, args as string[], {
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
