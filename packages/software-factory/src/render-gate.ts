/**
 * Render gate (v3 P0) — the first rung of the runtime feedback loop.
 *
 * Every static gate can pass while the card renders an empty section, a
 * broken layout, or an invisible affordance (the wardrobe run shipped all
 * five issues green and every one had a runtime defect). The render gate
 * closes the cheapest half of that hole: after an issue finishes, capture
 * real host-rendered screenshots of the cards it shipped via the realm
 * server's `POST /_screenshot-card` endpoint, attach them to the run log,
 * and hand the PNG paths to the acceptance walkthrough turn — whose agent
 * READS them with its image-capable Read tool and verdicts each
 * acceptance criterion against what is actually on screen.
 *
 * Endpoint contract (see realm-server handle-screenshot-card):
 * - formats: 'isolated' | 'embedded' only (fitted capture is an upstream
 *   ask — the prerenderer doesn't expose a sized fitted container yet).
 * - response: { data: { attributes: { status, base64?, width?, height?,
 *   error? } } }; status 'ready' is necessary but NOT sufficient for
 *   async domain renderers (WebGL/PDF/media may not have painted — bug
 *   report filed 2026-07-17), so treat screenshots of such cards as
 *   advisory.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { logger } from './logger.ts';

const log = logger('render-gate');

export type ScreenshotFormat = 'isolated' | 'embedded';

/**
 * A uniform-color PNG (blank render) compresses to almost nothing; a real
 * card screenshot is comfortably above this. Below the threshold we flag
 * the capture as a suspected blank so the walkthrough looks harder.
 */
const SUSPECT_BLANK_BYTES = 3_000;

export interface RenderGateOptions {
  /** Owns auth: `authedServerFetch` carries the realm-server JWT. */
  client: BoxelCLIClient;
  realmServerUrl: string;
  /** Product realm the cards live in. */
  targetRealm: string;
  /** Shared local workspace; PNGs land under design/render/. */
  workspaceDir: string;
}

export interface CardScreenshotResult {
  /** Realm-relative card path (no .json), e.g. `Garment/cloudmark-tee`. */
  cardPath: string;
  format: ScreenshotFormat;
  ok: boolean;
  /** Workspace-relative PNG path on success. */
  outputPath?: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** Tiny PNG — likely an empty/blank render. */
  suspectBlank?: boolean;
  error?: string;
}

export class RenderGate {
  private opts: RenderGateOptions;

  constructor(opts: RenderGateOptions) {
    this.opts = opts;
  }

  /**
   * Capture isolated + embedded screenshots for each card path (bounded
   * by `limit` cards). Sequential on purpose: the prerenderer queue
   * serializes per realm anyway, and burst-enqueueing just times out.
   * A failed capture retries once after a short indexing-settle delay.
   */
  async captureCards(
    cardPaths: string[],
    opts?: { limit?: number },
  ): Promise<CardScreenshotResult[]> {
    let limit = opts?.limit ?? 4;
    let results: CardScreenshotResult[] = [];
    for (let cardPath of cardPaths.slice(0, limit)) {
      for (let format of ['isolated', 'embedded'] as const) {
        let result = await this.captureOne(cardPath, format);
        if (!result.ok) {
          // One retry — the most common failure is the index not having
          // settled the just-synced instance yet.
          await sleep(5_000);
          result = await this.captureOne(cardPath, format);
        }
        results.push(result);
      }
    }
    return results;
  }

  private async captureOne(
    cardPath: string,
    format: ScreenshotFormat,
  ): Promise<CardScreenshotResult> {
    let { client, realmServerUrl, targetRealm, workspaceDir } = this.opts;
    let cardId = new URL(cardPath, targetRealm).href;
    try {
      let response = await client.authedServerFetch(
        new URL('_screenshot-card', realmServerUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: {
              type: 'screenshot-card',
              attributes: { realmURL: targetRealm, cardId, format },
            },
          }),
        },
      );
      if (!response.ok) {
        let text = await response.text().catch(() => '');
        return {
          cardPath,
          format,
          ok: false,
          error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
        };
      }
      let body = (await response.json()) as {
        data?: {
          attributes?: {
            status?: string;
            base64?: string;
            width?: number;
            height?: number;
            error?: string | null;
          };
        };
      };
      let attrs = body.data?.attributes;
      if (attrs?.status !== 'ready' || !attrs.base64) {
        return {
          cardPath,
          format,
          ok: false,
          error: `screenshot ${attrs?.status ?? 'no response'}: ${attrs?.error ?? 'no image data'}`,
        };
      }
      let png = Buffer.from(attrs.base64, 'base64');
      let outputPath = `design/render/${cardPath.replace(/\//g, '-')}-${format}.png`;
      let absolute = join(workspaceDir, outputPath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, png);
      let suspectBlank = png.byteLength < SUSPECT_BLANK_BYTES;
      log.info(
        `render gate: ${cardPath} (${format}) → ${outputPath} (${png.byteLength} bytes${suspectBlank ? ', SUSPECT BLANK' : ''})`,
      );
      return {
        cardPath,
        format,
        ok: true,
        outputPath,
        width: attrs.width,
        height: attrs.height,
        bytes: png.byteLength,
        ...(suspectBlank ? { suspectBlank: true } : {}),
      };
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      log.warn(`render gate capture failed for ${cardPath}: ${message}`);
      return { cardPath, format, ok: false, error: message };
    }
  }
}

/** One-line human summary for the run log / walkthrough prompt. */
export function summarizeRenderResults(
  results: CardScreenshotResult[],
): string {
  let ok = results.filter((r) => r.ok && !r.suspectBlank).length;
  let blank = results.filter((r) => r.suspectBlank).length;
  let failed = results.filter((r) => !r.ok).length;
  let parts = [`${ok}/${results.length} surfaces captured clean`];
  if (blank > 0) parts.push(`${blank} suspected blank`);
  if (failed > 0) parts.push(`${failed} failed to render`);
  return parts.join(', ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
