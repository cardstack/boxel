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
    try {
      await this.#browser.close();
    } catch (e) {
      log.warn('Error closing browser:', e);
    } finally {
      this.#browser = null;
      this.#browserUserDataDir = undefined;
    }
  }
}
