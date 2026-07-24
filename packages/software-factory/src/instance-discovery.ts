/**
 * Workspace-fallback discovery of instance card paths for the render
 * gate.
 *
 * The gate's primary source is the stream handler's in-memory sightings
 * of instance JSONs the agent WROTE this turn. That is empty for two
 * legitimate turn shapes: a resumed issue after a factory restart (the
 * agent verifies everything exists and signals done without writing),
 * and a fix turn that patches a `.gts` via `Edit` without touching
 * instances. Zero capture targets used to cascade into a false
 * "no renderable surface" acceptance verdict — the verifier, seeing no
 * screenshots, concluded the card doesn't render and filed a defect
 * issue whose own fix turn repeated the cycle (the wardrobe
 * defect-no-render → v2 → v3 chain, 2026-07-17).
 *
 * Fallback: scan the workspace's top-level `<Type>/<id>.json` instances
 * whose `meta.adoptsFrom.module` points at a local module (a product
 * card, not a tracker/base card), newest-modified first. The most
 * recently written instances belong to the most recently built card
 * family, so this approximates "this issue's cards" — and screenshots
 * of real cards beat zero evidence even when the mix is imperfect.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Control-plane and infra dirs that never hold product instances. */
const EXCLUDED_DIRS = new Set([
  'Issues',
  'Projects',
  'Boards',
  'Knowledge Articles',
  'Spec',
  'Validations',
  'Runs',
  'RunLogEntries',
  'design',
  'design-history',
]);

export async function discoverRecentInstanceCardPaths(
  workspaceDir: string,
  limit = 4,
): Promise<string[]> {
  let found: { cardPath: string; mtimeMs: number }[] = [];
  let entries;
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (let entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    let dirPath = join(workspaceDir, entry.name);
    let files;
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (let file of files) {
      if (!file.endsWith('.json')) continue;
      let filePath = join(dirPath, file);
      try {
        let doc = JSON.parse(await readFile(filePath, 'utf8'));
        let module = doc?.data?.meta?.adoptsFrom?.module;
        // Local relative module (`../garment`) = a product card built in
        // this realm. Absolute URLs are base/tracker/other-realm cards.
        if (typeof module !== 'string' || !module.startsWith('.')) continue;
        let { mtimeMs } = await stat(filePath);
        found.push({
          cardPath: `${entry.name}/${file.replace(/\.json$/, '')}`,
          mtimeMs,
        });
      } catch {
        continue; // unreadable/malformed JSON is not a candidate
      }
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, limit).map((f) => f.cardPath);
}
