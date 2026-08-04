/**
 * Screenshot execution — renders a workspace HTML file in headless Chromium
 * and writes a PNG next to it (or to a caller-chosen workspace path).
 *
 * This powers the factory's HTML-first design loop: the agent writes a plain
 * HTML+CSS mockup with real sample copy, screenshots it here, then Reads the
 * PNG with its native (image-capable) Read tool to critique and revise —
 * seconds per iteration, with no lint/index/realm round-trip in the loop.
 *
 * Uses `@playwright/test`'s bundled chromium (already a package dependency
 * for the QUnit runner path). Both the HTML input and the PNG output are
 * constrained to resolve inside the workspace directory.
 */

import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { logger } from './logger.ts';

const log = logger('screenshot-execution');

export interface ScreenshotHtmlOptions {
  /** Local workspace directory mirroring the target realm. */
  workspaceDir: string;
  /** Workspace-relative path to the HTML file to render. */
  path: string;
  /**
   * Workspace-relative output path for the PNG. Defaults to the HTML path
   * with its extension replaced by `.png`.
   */
  outputPath?: string;
  /** Viewport width in px. Defaults to 390 (mobile). */
  width?: number;
  /** Viewport height in px. Defaults to 844 (mobile). */
  height?: number;
  /** Capture the full scrollable page (default) or just the viewport. */
  fullPage?: boolean;
}

export interface ScreenshotHtmlResult {
  ok: boolean;
  /** Workspace-relative path of the written PNG on success. */
  outputPath?: string;
  error?: string;
  durationMs: number;
}

export async function captureHtmlScreenshot(
  options: ScreenshotHtmlOptions,
): Promise<ScreenshotHtmlResult> {
  let start = Date.now();
  let {
    workspaceDir,
    path: htmlPath,
    width = 390,
    height = 844,
    fullPage = true,
  } = options;

  let resolvedHtml = resolveInsideWorkspace(workspaceDir, htmlPath);
  if (!resolvedHtml) {
    return {
      ok: false,
      error: `Path "${htmlPath}" resolves outside the workspace. Use a workspace-relative path.`,
      durationMs: Date.now() - start,
    };
  }
  if (!/\.html?$/i.test(resolvedHtml)) {
    return {
      ok: false,
      error: `Path "${htmlPath}" is not an .html file.`,
      durationMs: Date.now() - start,
    };
  }
  try {
    await stat(resolvedHtml);
  } catch {
    return {
      ok: false,
      error: `HTML file "${htmlPath}" does not exist in the workspace. Write it first.`,
      durationMs: Date.now() - start,
    };
  }

  let outputRelative =
    options.outputPath ?? htmlPath.replace(/\.html?$/i, '.png');
  let resolvedOutput = resolveInsideWorkspace(workspaceDir, outputRelative);
  if (!resolvedOutput || !/\.png$/i.test(resolvedOutput)) {
    return {
      ok: false,
      error: `Output path "${outputRelative}" must be a workspace-relative .png path.`,
      durationMs: Date.now() - start,
    };
  }

  let { chromium } = await import('@playwright/test');
  let browser = await chromium.launch();
  try {
    let page = await browser.newPage({ viewport: { width, height } });
    await page.goto(pathToFileURL(resolvedHtml).href, { waitUntil: 'load' });
    // Give fonts/layout a beat to settle — file:// loads fire `load` before
    // font rasterization completes and a too-early capture shows fallbacks.
    await page.waitForTimeout(200);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await page.screenshot({ path: resolvedOutput, fullPage });
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    log.warn(`screenshot of ${htmlPath} failed: ${message}`);
    return {
      ok: false,
      error: `Screenshot failed: ${message}`,
      durationMs: Date.now() - start,
    };
  } finally {
    await browser.close();
  }

  log.info(
    `screenshot ${htmlPath} → ${outputRelative} (${width}x${height}, fullPage=${fullPage})`,
  );
  return {
    ok: true,
    outputPath: outputRelative,
    durationMs: Date.now() - start,
  };
}

function resolveInsideWorkspace(
  workspaceDir: string,
  candidate: string,
): string | undefined {
  let root = resolve(workspaceDir);
  let abs = resolve(root, candidate);
  let rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return undefined;
  }
  return abs;
}
