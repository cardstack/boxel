import { logger } from '@cardstack/runtime-common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import puppeteer, { type Browser } from 'puppeteer';

const log = logger('prerenderer');
const PUPPETEER_PROFILE_PREFIX = 'puppeteer_dev_chrome_profile-';
const USER_DATA_MAX_AGE_MS = 60 * 60 * 1000;

export class BrowserManager {
  #browser: Browser | null = null;
  #browserUserDataDir: string | undefined;

  async getBrowser(): Promise<Browser> {
    if (this.#browser) {
      return this.#browser;
    }
    await this.cleanupUserDataDirs();

    let launchArgs: string[] = [];
    let disableSandbox =
      process.env.CI === 'true' ||
      process.env.PUPPETEER_DISABLE_SANDBOX === 'true';
    if (disableSandbox) {
      launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    let extraArgs =
      process.env.PUPPETEER_CHROME_ARGS?.split(/\s+/).filter(Boolean);
    if (extraArgs && extraArgs.length > 0) {
      launchArgs.push(...extraArgs);
    }

    this.#browser = await puppeteer.launch({
      headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
      ...(launchArgs.length > 0 ? { args: launchArgs } : {}),
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
    });

    this.#browserUserDataDir = this.#extractUserDataDir(this.#browser);
    return this.#browser;
  }

  async restartBrowser(): Promise<void> {
    await this.#closeBrowser();
    await this.cleanupUserDataDirs();
  }

  async stop(): Promise<void> {
    await this.#closeBrowser();
    await this.cleanupUserDataDirs();
  }

  async cleanupUserDataDirs(): Promise<void> {
    let activeDir = this.#browserUserDataDir;
    if (!activeDir && this.#browser) {
      // If Puppeteer is running but we cannot locate its profile, avoid deleting.
      log.warn(
        'Cannot locate active browser user data directory; skipping cleanup to avoid deleting active profile',
      );
      return;
    }

    await this.#terminateOrphanedChromeProcesses(activeDir);

    let tmpRoot: string;
    try {
      tmpRoot = tmpdir();
    } catch (_e) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(tmpRoot, { withFileTypes: true });
    } catch (_e) {
      return;
    }

    let now = Date.now();
    for (let entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith(PUPPETEER_PROFILE_PREFIX)) continue;

      let dirPath = path.join(tmpRoot, entry.name);
      if (activeDir && path.resolve(dirPath) === path.resolve(activeDir)) {
        continue;
      }

      let stat;
      try {
        stat = await fs.stat(dirPath);
      } catch (_e) {
        continue;
      }
      if (now - stat.mtimeMs < USER_DATA_MAX_AGE_MS) continue;

      try {
        await fs.rm(dirPath, { recursive: true, force: true });
      } catch (e) {
        log.debug('Unable to remove user data dir %s:', dirPath, e);
      }
    }
  }

  async #terminateOrphanedChromeProcesses(activeDir?: string): Promise<void> {
    let orphaned = await this.#findOrphanedChromeProcesses(activeDir);
    if (orphaned.length === 0) {
      return;
    }
    log.warn(
      'Terminating %s orphaned Chrome process(es) tied to stale Puppeteer profiles',
      orphaned.length,
    );
    for (let { pid } of orphaned) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (_e) {
        // best-effort; process may have already exited
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (let { pid } of orphaned) {
      if (this.#isProcessAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (_e) {
          // best-effort; process may have already exited
        }
      }
    }
  }

  async #findOrphanedChromeProcesses(
    activeDir?: string,
  ): Promise<Array<{ pid: number; userDataDir: string }>> {
    let procEntries: string[];
    try {
      procEntries = await fs.readdir('/proc');
    } catch (_e) {
      return [];
    }
    let orphaned: Array<{ pid: number; userDataDir: string }> = [];
    let tmpRoot = tmpdir();
    for (let entry of procEntries) {
      if (!/^\d+$/.test(entry)) continue;
      let pid = Number(entry);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      let cmdline = await this.#readProcessCmdline(pid);
      if (!cmdline) continue;
      if (!cmdline.includes('chrome')) continue;
      let userDataDir = this.#extractUserDataDirFromCmdline(cmdline);
      if (!userDataDir) continue;
      if (!path.basename(userDataDir).startsWith(PUPPETEER_PROFILE_PREFIX)) {
        continue;
      }
      if (!path.resolve(userDataDir).startsWith(path.resolve(tmpRoot))) {
        continue;
      }
      if (activeDir && path.resolve(userDataDir) === path.resolve(activeDir)) {
        continue;
      }
      let ppid = await this.#readParentPid(pid);
      if (ppid === undefined) continue;
      if (await this.#isOrphanedParent(ppid)) {
        orphaned.push({ pid, userDataDir });
      }
    }
    return orphaned;
  }

  async #readProcessCmdline(pid: number): Promise<string | undefined> {
    try {
      let raw = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
      if (!raw) {
        return undefined;
      }
      return raw.split('\0').join(' ').trim();
    } catch (_e) {
      return undefined;
    }
  }

  async #readParentPid(pid: number): Promise<number | undefined> {
    try {
      let status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
      let match = status.match(/^PPid:\s+(\d+)$/m);
      if (!match) {
        return undefined;
      }
      return Number(match[1]);
    } catch (_e) {
      return undefined;
    }
  }

  async #isOrphanedParent(ppid: number): Promise<boolean> {
    if (ppid <= 1) {
      return true;
    }
    let parentCmdline = await this.#readProcessCmdline(ppid);
    if (!parentCmdline) {
      return true;
    }
    return parentCmdline.includes('systemd --user');
  }

  #isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (_e) {
      return false;
    }
  }

  #extractUserDataDirFromCmdline(cmdline: string): string | undefined {
    let split = cmdline.split(/\s+/);
    for (let i = 0; i < split.length; i++) {
      let arg = split[i];
      let match = arg.match(/^--user-data-dir=(.*)$/);
      if (match?.[1]) {
        return match[1];
      }
      if (arg === '--user-data-dir' && split[i + 1]) {
        return split[i + 1];
      }
    }
    return undefined;
  }

  #extractUserDataDir(browser: Browser | null): string | undefined {
    let args = browser?.process()?.spawnargs;
    if (!args) {
      return undefined;
    }
    for (let i = 0; i < args.length; i++) {
      let arg = args[i];
      if (typeof arg !== 'string') continue;
      let match = arg.match(/^--user-data-dir=(.*)$/);
      if (match?.[1]) {
        return match[1];
      }
      if (arg === '--user-data-dir' && typeof args[i + 1] === 'string') {
        return args[i + 1];
      }
    }
    return undefined;
  }

  async #closeBrowser(): Promise<void> {
    if (!this.#browser) {
      return;
    }
    let proc = this.#browser.process();
    try {
      await this.#browser.close();
    } catch (e) {
      log.warn('Error closing browser:', e);
    } finally {
      if (proc && proc.exitCode === null && !proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch (_e) {
          // best-effort cleanup
        }
      }
      this.#browser = null;
      this.#browserUserDataDir = undefined;
    }
  }
}
