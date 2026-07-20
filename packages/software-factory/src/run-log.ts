/**
 * Run log — the live-blog surface for a factory run.
 *
 * The factory writes a `run-log.gts` module (a `RunLog` app card + a
 * `RunLogEntry` card) into the control realm. Each real event (issue picked,
 * design screenshot, validation result, card ready, run done) becomes ONE
 * `RunLogEntry` instance under `RunLogEntries/` — a single small write, never
 * a rewrite of a growing array. The `RunLog` isolated view is a live,
 * realm-scoped, newest-first, page-capped query over those entries (the same
 * shape as the platform's workspace Activity feed). The operator watches the
 * card in the realm instead of tailing a terminal; design screenshots embed
 * as images and the REAL built card embeds live, each via a `linksTo` on its
 * entry. Churn kinds (status/iteration) are dropped so the feed stays a blog
 * of milestones, not an audit log.
 */

import {
  readFile,
  writeFile,
  mkdir,
  stat,
  copyFile,
  readdir,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isControlPath } from './control-plane-sync.ts';
import { logger } from './logger.ts';

const log = logger('run-log');

// ---------------------------------------------------------------------------
// Card-reference auto-linking
// ---------------------------------------------------------------------------

/**
 * A card-instance path under a capitalized card-type directory
 * (`Knowledge Articles/…`, `Garment/…`, `Spec/…`) — a single PascalCase
 * token or the literal `Knowledge Articles` (the base catalog's only spaced
 * dir), then `/<name>.json`. Deliberately narrow so prose like "the Foo Bar
 * report" and non-card files (`design/tokens.css`, lowercase dirs) never
 * match. As a source fragment (no flags/anchors) so it can be composed into
 * the directive/link/bare matchers below.
 */
const CARD_PATH = String.raw`(Knowledge Articles|[A-Z][A-Za-z0-9]+)\/([A-Za-z0-9._-]+)\.json`;

/**
 * Resolve a workspace card path (`<dir>/<name>`, no `.json`) to its full
 * card URL. Control-plane paths (Knowledge Articles, Issues, Projects,
 * Boards, …) resolve against the control realm; product cards — built
 * cards (Garment, Outfit, …) and their Catalog Specs — against the
 * product realm.
 */
function resolveCardUrl(
  dir: string,
  name: string,
  realms: { controlRealm?: string; productRealm: string },
): string {
  let relPath = `${dir}/${name}`;
  let base = isControlPath(relPath)
    ? (realms.controlRealm ?? realms.productRealm)
    : realms.productRealm;
  return new URL(relPath, base).href;
}

/**
 * Resolve card references in a run-log entry body so the MarkdownField
 * renders them as live cards. The agent is taught (post_update tool) to
 * author BFM card directives using the workspace PATH and to choose the
 * format — inline `:card[…]` (atom), block `::card[…]` (embedded), or
 * `::card[… | fitted strip]` (a sized tile). It knows the path but not the
 * realm routing, so this fills in the full URL and picks control-vs-product
 * realm. Four ordered rewrites, applied only outside fenced code blocks
 * (BFM keeps directives literal there, so rewriting would corrupt code
 * samples):
 *
 *  1. markdown-link targets   `[text](Dir/name.json)`      → `[text](URL)`
 *  2. block directives        `::card[Dir/name.json | s]`  → `::card[URL | s]`
 *  3. inline directives       `:card[Dir/name.json]`       → `:card[URL]`
 *  4. bare / backticked paths  `` `Dir/name.json` ``        → `:card[URL]` (atom fallback)
 *
 * Directives the agent already wrote with a full URL carry no `.json` path
 * segment, so they pass through untouched. Unresolvable targets degrade to
 * a muted pill, so linking a not-yet-indexed card is safe.
 */
export function autolinkCardReferences(
  body: string,
  realms: { controlRealm?: string; productRealm: string },
): string {
  let resolve = (dir: string, name: string) =>
    resolveCardUrl(dir, name, realms);
  let segments = body.split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment) => {
      if (segment.startsWith('```')) return segment;
      return (
        segment
          // 1. Markdown-link targets — keep the link, resolve the path.
          .replace(
            new RegExp(String.raw`\]\(\s*${CARD_PATH}\s*\)`, 'g'),
            (_m, dir, name) => `](${resolve(dir, name)})`,
          )
          // 2. Block directives with an optional `| spec` — preserve the spec.
          .replace(
            new RegExp(
              String.raw`::card\[\s*${CARD_PATH}\s*(\|[^\]]*?)?\s*\]`,
              'g',
            ),
            (_m, dir, name, spec) =>
              `::card[${resolve(dir, name)}${spec ? ` ${spec.trim()}` : ''}]`,
          )
          // 3. Inline directives (single colon; not the `::` block form).
          .replace(
            new RegExp(String.raw`(?<!:):card\[\s*${CARD_PATH}\s*\]`, 'g'),
            (_m, dir, name) => `:card[${resolve(dir, name)}]`,
          )
          // 4. Bare or backticked path in prose → inline atom fallback.
          .replace(
            new RegExp(String.raw`\`?${CARD_PATH}\`?`, 'g'),
            (_m, dir, name) => `:card[${resolve(dir, name)}]`,
          )
      );
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunLogEntryInput {
  kind:
    | 'phase'
    | 'issue-picked'
    | 'design'
    | 'validation'
    | 'card-ready'
    | 'issue-done'
    | 'run-done'
    | 'status'
    | 'status-change'
    | 'iteration'
    | 'comment'
    | 'progress'
    | 'decision'
    | 'agent-spawn'
    | 'blocked'
    | 'note'
    // Orchestrator monitor (v3): stall narration / scheduler / watchdog
    // notes, and per-turn cost/duration telemetry. See run-monitor.ts.
    | 'monitor'
    | 'telemetry';
  headline: string;
  body?: string;
  /** Absolute URL of a screenshot image to embed (public realms only). */
  imageUrl?: string;
  /**
   * Realm-relative path of the screenshot's FILE CARD (extension kept,
   * e.g. `design/song-isolated.png`) — preferred over imageUrl: the PngDef
   * card renders with realm auth handled.
   */
  imageCardPath?: string;
  /**
   * Realm-relative card path (no .json extension, relative to realm root,
   * e.g. `JaraokePlayer/thursday-night-jaraoke`) — embeds the live card.
   */
  cardPath?: string;
  /**
   * Which realm `cardPath` is relative to under the v3 control/product
   * split: 'product' (default — built cards in the target realm) or
   * 'control' (issues, validation artifacts). Links are written as
   * absolute URLs so they resolve regardless of which realm hosts the
   * run log. Without a split the two realms coincide.
   */
  cardRealm?: 'product' | 'control';
  /**
   * Absolute URL of the Issue card this entry belongs to (issues live in the
   * control realm). Set on every entry produced during an issue's turn so the
   * feed row links straight to the issue — the portal from which the operator
   * reaches the project, spec, built card, and acceptance criteria.
   */
  issueUrl?: string;
  /** Who is speaking: orchestrator | executor | validator | an agent name. */
  who?: string;
}

export interface RunLogWriterOptions {
  workspaceDir: string;
  targetRealm: string;
  /**
   * Control realm hosting the run log under the v3 split. Defaults to
   * `targetRealm` (no split). Entry links resolve absolute: cardPath
   * against `targetRealm` (or `controlRealm` when the entry says
   * `cardRealm: 'control'`), imageCardPath against `targetRealm` (design
   * PNGs ride the product sync — raw writes are text-only).
   */
  controlRealm?: string;
  runSlug: string;
  runTitle: string;
  /** Push the workspace to the realm (the loop's shared sync gate). */
  syncWorkspace: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Raw single-file write to the realm (card-source MIME, content as-is).
   * Workaround for the /_atomic?waitForIndex=true bug that rewrites card
   * sources with containsMany FieldDef attributes stripped to `{}`: after
   * every workspace sync, the run-log instance is re-written raw so the
   * live blog keeps its entry data. Optional — when absent the writer
   * relies on syncWorkspace alone (and entries may render blank).
   */
  rawWriteFile?: (
    relativePath: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Kinds that are audit-trail churn, not live-blog milestones — every issue
 * status transition and inner-iteration marker. They were the bulk of the
 * old run log's volume (hundreds of "backlog → in progress → done" lines) and
 * would flood the feed. They never become entry cards; the meaningful signal
 * they carried lives in `issue-done` / `card-ready` / `blocked` entries and
 * in the index card's `nowWorkingOn`.
 */
const FEED_NOISE_KINDS = new Set(['status', 'iteration']);

/** How many of the most-recent legacy entries a migration carries forward. */
const MIGRATION_KEEP_RECENT = 60;

export class RunLogWriter {
  private opts: RunLogWriterOptions;
  /** The small RunLog "index" card: masthead, status, and milestone counters. */
  private instancePath: string;
  /** Directory of one-file-per-entry RunLogEntry cards. */
  private entriesDir: string;
  /** Monotonic per-run entry sequence — the feed query's stable sort key. */
  private seq = 0;
  /**
   * Milestone counters mirrored onto the index card so the header renders
   * without scanning the feed. Entries are separate cards now, so a new
   * entry is one small write — never a rewrite of a growing array.
   */
  private counts = {
    entry: 0,
    cardsReady: 0,
    designRounds: 0,
    validationsGreen: 0,
    issuesDone: 0,
  };
  /**
   * All writes are serialized through this chain: streamed appends fire
   * from tool-call hooks mid-agent-turn and would otherwise race the
   * loop's own read-modify-write appends.
   */
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: RunLogWriterOptions) {
    this.opts = opts;
    this.instancePath = join(opts.workspaceDir, 'Runs', `${opts.runSlug}.json`);
    this.entriesDir = join(opts.workspaceDir, 'RunLogEntries');
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    let next = this.chain.then(fn, fn);
    this.chain = next;
    return next;
  }

  /** Idempotent: writes the CardDef module if missing and creates or re-arms the index card. */
  async start(): Promise<void> {
    try {
      let modulePath = join(this.opts.workspaceDir, 'run-log.gts');
      // Always (re)write the module so a code-level RUN_LOG_GTS upgrade
      // propagates to existing realms on restart. The control-plane sync is
      // content-hash-gated, so an unchanged module is a no-op over the wire.
      await writeFile(modulePath, RUN_LOG_GTS, 'utf8');
      await mkdir(this.entriesDir, { recursive: true });

      if (await fileExists(this.instancePath)) {
        // Restart. If the existing index is the legacy containsMany format,
        // convert its entries[] array into individual RunLogEntry cards
        // before continuing (one-time, in place). Otherwise just recover seq
        // + counters so the sequence continues monotonically.
        let migrated = await this.migrateLegacyIndexIfNeeded();
        if (!migrated) {
          await this.recoverState();
        }
        await this.append([
          {
            kind: 'phase',
            headline: 'Run restarted',
            body: `New factory run against this brief started at ${new Date().toISOString()}.`,
          },
        ]);
        await this.patch({ status: 'running' });
        return;
      }

      let doc = {
        data: {
          type: 'card',
          attributes: {
            runTitle: this.opts.runTitle,
            status: 'running',
            nowWorkingOn: 'Bootstrapping',
            upNext: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            runId: this.opts.runSlug,
            entryCount: 0,
            cardsReadyCount: 0,
            designRoundsCount: 0,
            validationsGreenCount: 0,
            issuesDoneCount: 0,
            cardInfo: {
              name: `Run log — ${this.opts.runTitle}`,
              notes: null,
              summary:
                'Live blog of this factory run: design rounds, validations, and finished cards as they land.',
              cardThumbnailURL: null,
            },
          },
          relationships: {},
          meta: {
            adoptsFrom: { module: '../run-log', name: 'RunLog' },
          },
        },
      };
      await mkdir(dirname(this.instancePath), { recursive: true });
      await writeFile(this.instancePath, JSON.stringify(doc, null, 2), 'utf8');
      await this.append([{ kind: 'phase', headline: 'Run started' }]);
    } catch (error) {
      // The run log must never take down a run.
      log.warn(`run-log start failed: ${String(error)}`);
    }
  }

  /**
   * Restore `seq` and `counts` after a restart: the highest existing entry
   * seq for this run, and the counters last written to the index card.
   */
  private async recoverState(): Promise<void> {
    try {
      let doc = JSON.parse(await readFile(this.instancePath, 'utf8'));
      let a = doc?.data?.attributes ?? {};
      this.counts = {
        entry: Number(a.entryCount) || 0,
        cardsReady: Number(a.cardsReadyCount) || 0,
        designRounds: Number(a.designRoundsCount) || 0,
        validationsGreen: Number(a.validationsGreenCount) || 0,
        issuesDone: Number(a.issuesDoneCount) || 0,
      };
    } catch {
      // Index unreadable — counters stay at zero.
    }
    try {
      let prefix = `${this.opts.runSlug}-`;
      let files = await readdir(this.entriesDir);
      let maxSeq = 0;
      for (let f of files) {
        if (!f.startsWith(prefix) || !f.endsWith('.json')) continue;
        let n = Number(f.slice(prefix.length, -'.json'.length));
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
      this.seq = Math.max(this.seq, maxSeq);
    } catch {
      // No entries dir yet — seq stays as is.
    }
  }

  /**
   * One-time in-place conversion of a legacy containsMany run log into the
   * card-per-entry format: reads the existing index, and if it carries an
   * `entries` array, writes one RunLogEntry card per element into
   * `RunLogEntries/`, rewrites the index without the array (counters
   * populated), and seeds `this.seq`/`this.counts` so appends continue from
   * the migrated tail. Returns true when a migration happened. Best-effort —
   * any failure leaves the run log untouched and returns false.
   */
  private async migrateLegacyIndexIfNeeded(): Promise<boolean> {
    let oldDoc: unknown;
    try {
      oldDoc = JSON.parse(await readFile(this.instancePath, 'utf8'));
    } catch {
      return false;
    }
    let plan = buildLegacyMigration(oldDoc, this.opts.runSlug);
    if (!plan) return false;
    try {
      await mkdir(this.entriesDir, { recursive: true });
      for (let entry of plan.entries) {
        await writeFile(
          join(this.opts.workspaceDir, entry.relPath),
          JSON.stringify(entry.doc, null, 2),
          'utf8',
        );
      }
      await writeFile(
        this.instancePath,
        JSON.stringify(plan.index, null, 2),
        'utf8',
      );
      this.seq = plan.seq;
      this.counts = plan.counts;
      log.info(
        `run-log migrated ${plan.entries.length} legacy entr${plan.entries.length === 1 ? 'y' : 'ies'} to card format`,
      );
      return true;
    } catch (error) {
      log.warn(`run-log legacy migration failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Append one or more entries in a single write+sync. With
   * `opts.stream: true` the full workspace sync is skipped — the instance
   * is raw-written to the realm directly, which is cheap enough to call
   * from per-tool-call streaming hooks mid-agent-turn.
   */
  async append(
    entries: RunLogEntryInput[],
    updates?: { nowWorkingOn?: string; upNext?: string },
    opts?: { stream?: boolean },
  ): Promise<void> {
    // Drop churn kinds before they ever become cards — they flood the feed
    // and add no milestone value. `updates` (now/next) still apply even when
    // the whole batch was noise.
    let feedEntries = entries.filter((e) => !FEED_NOISE_KINDS.has(e.kind));
    if (feedEntries.length === 0 && !updates) return;
    return this.enqueue(async () => {
      try {
        let milestoneBumped = false;
        for (let entry of feedEntries) {
          this.seq += 1;
          this.counts.entry += 1;
          if (this.bumpCounters(entry)) milestoneBumped = true;
          let relPath = this.entryRelPath(this.seq);
          let content = JSON.stringify(
            this.buildEntryDoc(entry, this.seq),
            null,
            2,
          );
          await writeFile(
            join(this.opts.workspaceDir, relPath),
            content,
            'utf8',
          );
          // Streamed (mid-turn) entries raw-write straight to the realm so
          // the indexer surfaces them in the live feed without waiting for a
          // full workspace sync.
          if (opts?.stream && this.opts.rawWriteFile) {
            let w = await this.opts.rawWriteFile(relPath, content);
            if (!w.ok)
              log.warn(
                `run-log entry raw-write failed: ${w.error ?? 'unknown'}`,
              );
          }
        }

        // Rewrite the tiny index card only when it actually changed — a
        // milestone counter moved, an explicit now/next update, or we're
        // still in the warm-up window (<5 entries) where entryCount drives
        // the "setup phase" hint. Plain comments after warm-up touch nothing
        // but their own entry card.
        let needIndexWrite =
          milestoneBumped || updates !== undefined || this.counts.entry <= 5;
        if (needIndexWrite) {
          await this.writeIndex(updates, opts?.stream === true);
        }

        if (!opts?.stream) {
          await this.syncUnqueued();
        }
      } catch (error) {
        log.warn(`run-log append failed: ${String(error)}`);
      }
    });
  }

  private entryRelPath(seq: number): string {
    return `RunLogEntries/${this.opts.runSlug}-${String(seq).padStart(6, '0')}.json`;
  }

  /** Bump milestone counters for this entry; returns true if any moved. */
  private bumpCounters(entry: RunLogEntryInput): boolean {
    if (entry.kind === 'card-ready') {
      this.counts.cardsReady += 1;
      return true;
    }
    if (entry.kind === 'design') {
      this.counts.designRounds += 1;
      return true;
    }
    if (entry.kind === 'issue-done') {
      this.counts.issuesDone += 1;
      return true;
    }
    if (
      entry.kind === 'validation' &&
      !(entry.headline ?? '').toLowerCase().includes('fail')
    ) {
      this.counts.validationsGreen += 1;
      return true;
    }
    return false;
  }

  private buildEntryDoc(entry: RunLogEntryInput, seq: number): unknown {
    let relationships: Record<string, unknown> = {};
    if (entry.cardPath) {
      let base =
        entry.cardRealm === 'control'
          ? (this.opts.controlRealm ?? this.opts.targetRealm)
          : this.opts.targetRealm;
      relationships.card = {
        links: { self: new URL(entry.cardPath, base).href },
      };
    }
    if (entry.imageCardPath) {
      relationships.image = {
        links: {
          self: new URL(entry.imageCardPath, this.opts.targetRealm).href,
        },
      };
    }
    if (entry.issueUrl) {
      relationships.issue = { links: { self: entry.issueUrl } };
    }
    return {
      data: {
        type: 'card',
        attributes: {
          runId: this.opts.runSlug,
          seq,
          kind: entry.kind,
          postedAt: new Date().toISOString(),
          headline: entry.headline,
          body: entry.body
            ? autolinkCardReferences(entry.body, {
                controlRealm: this.opts.controlRealm,
                productRealm: this.opts.targetRealm,
              })
            : null,
          imageUrl: entry.imageUrl ?? null,
          // The writer is the orchestrator's pen; streamed agent entries
          // pass their own voice ('executor', an agent name, …).
          who: entry.who ?? 'orchestrator',
          cardInfo: { name: entry.headline },
        },
        relationships,
        meta: {
          adoptsFrom: { module: '../run-log', name: 'RunLogEntry' },
        },
      },
    };
  }

  /** Read-modify-write the small index card (counters + optional now/next). */
  private async writeIndex(
    updates: { nowWorkingOn?: string; upNext?: string } | undefined,
    stream: boolean,
  ): Promise<void> {
    let doc = JSON.parse(await readFile(this.instancePath, 'utf8'));
    let attrs = doc.data.attributes;
    attrs.entryCount = this.counts.entry;
    attrs.cardsReadyCount = this.counts.cardsReady;
    attrs.designRoundsCount = this.counts.designRounds;
    attrs.validationsGreenCount = this.counts.validationsGreen;
    attrs.issuesDoneCount = this.counts.issuesDone;
    if (updates?.nowWorkingOn !== undefined)
      attrs.nowWorkingOn = updates.nowWorkingOn;
    if (updates?.upNext !== undefined) attrs.upNext = updates.upNext;
    let content = JSON.stringify(doc, null, 2);
    await writeFile(this.instancePath, content, 'utf8');
    if (stream && this.opts.rawWriteFile) {
      let w = await this.opts.rawWriteFile(
        `Runs/${this.opts.runSlug}.json`,
        content,
      );
      if (!w.ok)
        log.warn(`run-log index raw-write failed: ${w.error ?? 'unknown'}`);
    }
  }

  async finish(status: 'completed' | 'failed' | 'stopped'): Promise<void> {
    try {
      await this.append(
        [
          {
            kind: 'run-done',
            headline:
              status === 'completed' ? 'Run completed' : `Run ${status}`,
          },
        ],
        { nowWorkingOn: '—', upNext: '—' },
      );
      await this.patch({ status, finishedAt: new Date().toISOString() });
    } catch (error) {
      log.warn(`run-log finish failed: ${String(error)}`);
    }
  }

  private async patch(updates: {
    status?: string;
    finishedAt?: string;
  }): Promise<void> {
    return this.enqueue(async () => {
      let doc = JSON.parse(await readFile(this.instancePath, 'utf8'));
      if (updates.status) {
        doc.data.attributes.status = updates.status;
      }
      if (updates.finishedAt) {
        doc.data.attributes.finishedAt = updates.finishedAt;
      }
      let content = JSON.stringify(doc, null, 2);
      await writeFile(this.instancePath, content, 'utf8');
      // Best-effort immediate realm write so status flips promptly; the next
      // full sync reconciles regardless.
      if (this.opts.rawWriteFile) {
        await this.opts.rawWriteFile(`Runs/${this.opts.runSlug}.json`, content);
      }
      await this.syncUnqueued();
    });
  }

  private async syncUnqueued(): Promise<void> {
    let result = await this.opts.syncWorkspace();
    if (!result.ok) {
      log.warn(`run-log sync failed: ${result.error ?? 'unknown'}`);
    }
  }

  /**
   * Vestigial no-op. The FieldDef-strip heal existed only because the run
   * log was a single card with a `containsMany(RunLogEntry)` array that the
   * `/_atomic?waitForIndex=true` path stripped to `{}` on every sync. Entries
   * are now independent cards with no containsMany field, so nothing gets
   * stripped and there is nothing to heal. Kept so the loop's postSyncHeal
   * wiring compiles without change.
   */
  async healInstance(): Promise<void> {
    return;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface LegacyMigrationPlan {
  index: unknown;
  entries: { relPath: string; doc: unknown }[];
  seq: number;
  counts: RunLogWriter['counts'];
}

/**
 * Pure conversion of a legacy containsMany run-log index document into the
 * card-per-entry plan. Returns null when the doc is not legacy (no
 * `attributes.entries` array) — e.g. an already-migrated index or a fresh
 * one. Exported for direct testing.
 *
 * Each `entries[i]` element (fields `kind`, `at`, `headline`, `body`,
 * `imageUrl`, `who`) becomes a RunLogEntry card at
 * `RunLogEntries/<runSlug>-<seq>.json`, carrying forward its `entries.i.card`
 * / `entries.i.image` links from the index's relationships. The rewritten
 * index keeps the masthead fields and drops the array in favor of counters.
 */
export function buildLegacyMigration(
  oldDoc: unknown,
  runSlug: string,
): LegacyMigrationPlan | null {
  let data = (oldDoc as { data?: { attributes?: any; relationships?: any } })
    ?.data;
  let attrs = data?.attributes;
  let legacyEntries = attrs?.entries;
  if (!attrs || !Array.isArray(legacyEntries)) return null;

  let oldRels: Record<string, any> = data?.relationships ?? {};

  // Pass 1 — milestone counters over the WHOLE history, so the rail stats
  // stay accurate even though we only carry the recent tail forward.
  let counts = {
    entry: 0,
    cardsReady: 0,
    designRounds: 0,
    validationsGreen: 0,
    issuesDone: 0,
  };
  legacyEntries.forEach((e: any) => {
    let kind = e?.kind;
    let headline = String(e?.headline ?? '');
    if (kind === 'card-ready') counts.cardsReady += 1;
    else if (kind === 'design') counts.designRounds += 1;
    else if (kind === 'issue-done') counts.issuesDone += 1;
    else if (kind === 'validation' && !headline.toLowerCase().includes('fail'))
      counts.validationsGreen += 1;
  });

  // Pass 2 — carry only the most-recent meaningful entries as cards (drop
  // status/iteration churn; cap the count) so the migration doesn't recreate
  // the flood we're fixing. Keep original indices for relationship lookup,
  // then re-sequence the kept entries 1..K.
  let meaningful = legacyEntries
    .map((e: any, i: number) => ({ e, i }))
    .filter(({ e }: { e: any }) => !FEED_NOISE_KINDS.has(e?.kind));
  let kept = meaningful.slice(-MIGRATION_KEEP_RECENT);
  let entries: { relPath: string; doc: unknown }[] = kept.map(
    ({ e, i }: { e: any; i: number }, k: number) => {
      let seq = k + 1;
      let headline = e?.headline ?? '';
      let relationships: Record<string, unknown> = {};
      let cardLink = oldRels[`entries.${i}.card`]?.links?.self;
      let imageLink = oldRels[`entries.${i}.image`]?.links?.self;
      if (cardLink) relationships.card = { links: { self: cardLink } };
      if (imageLink) relationships.image = { links: { self: imageLink } };
      return {
        relPath: `RunLogEntries/${runSlug}-${String(seq).padStart(6, '0')}.json`,
        doc: {
          data: {
            type: 'card',
            attributes: {
              runId: runSlug,
              seq,
              kind: e?.kind ?? 'note',
              postedAt: e?.at ?? null,
              headline,
              body: e?.body ?? null,
              imageUrl: e?.imageUrl ?? null,
              who: e?.who ?? 'orchestrator',
              cardInfo: { name: headline || 'Run log entry' },
            },
            relationships,
            meta: { adoptsFrom: { module: '../run-log', name: 'RunLogEntry' } },
          },
        },
      };
    },
  );
  counts.entry = kept.length;

  let index = {
    data: {
      type: 'card',
      attributes: {
        runTitle: attrs.runTitle ?? null,
        status: attrs.status ?? 'running',
        nowWorkingOn: attrs.nowWorkingOn ?? null,
        upNext: attrs.upNext ?? null,
        startedAt: attrs.startedAt ?? null,
        finishedAt: attrs.finishedAt ?? null,
        runId: runSlug,
        entryCount: counts.entry,
        cardsReadyCount: counts.cardsReady,
        designRoundsCount: counts.designRounds,
        validationsGreenCount: counts.validationsGreen,
        issuesDoneCount: counts.issuesDone,
        cardInfo: attrs.cardInfo ?? { name: `Run log — ${runSlug}` },
      },
      relationships: {},
      meta: { adoptsFrom: { module: '../run-log', name: 'RunLog' } },
    },
  };

  return { index, entries, seq: kept.length, counts };
}

// ---------------------------------------------------------------------------
// Live-blog streaming: tool-call events → run-log entries, mid-agent-turn
// ---------------------------------------------------------------------------

const POST_UPDATE_KINDS = new Set(['comment', 'progress', 'decision']);
const CHECK_TOOLS = [
  'run_lint',
  'run_parse',
  'run_evaluate',
  'run_instantiate',
];
const CHECK_FAIL_MIN_INTERVAL_MS = 120_000;

/**
 * Best-effort one-to-three-line summary of a failed mid-turn self-check
 * (`run_lint` / `run_parse` / `run_evaluate` / `run_instantiate`), for the
 * run-log entry's body since these tools write no realm artifact to link
 * to. Each tool names its failure list and per-item message field
 * differently (lint: `violations[].message`, parse: `errors[].message`,
 * evaluate/instantiate: `failures[].error`) — try each in turn and fall
 * back to `errorMessage` or a generic line so the entry is never blank.
 */
export function summarizeCheckFailure(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  let r = result as Record<string, unknown>;
  let items = (r.violations ?? r.errors ?? r.failures) as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(items) && items.length > 0) {
    let lines = items.slice(0, 3).map((item) => {
      // `||` not `??`: an instantiate failure's `path` is `''` (not
      // undefined) for a bare-instantiation fallback with no example file,
      // and an empty string must fall through to `cardName` too.
      let file = (item.file || item.path || item.cardName) as
        | string
        | undefined;
      let message = (item.message ?? item.error) as string | undefined;
      return file ? `${file}: ${message ?? 'failed'}` : (message ?? 'failed');
    });
    let more = items.length > 3 ? ` (+${items.length - 3} more)` : '';
    return lines.join('\n') + more;
  }
  if (typeof r.errorMessage === 'string' && r.errorMessage) {
    return r.errorMessage;
  }
  return undefined;
}

/**
 * Copy a `design/` (or `design/render/`) screenshot into `design-history/`
 * and return the path a run-log entry should link to instead.
 *
 * `design/` is BUILD-turn scratch: once a mockup is translated into a real
 * card, the agent routinely deletes its `design/*.png` files as tidy-up,
 * and the next workspace sync mirrors that local deletion to the realm —
 * silently orphaning any run-log entry that already linked to it.
 * `design-history/` is never written or touched by the agent, so nothing
 * ever goes missing there and a later sync has no deletion to propagate.
 *
 * Preserves the path under `design/` (not just the basename): the agent
 * doesn't always slug-prefix screenshot names (this run alone produced
 * both `design/prompt-template-v1.png` and generic ones like
 * `design/v2-top.png`), and render-gate output collides by construction
 * whenever two different cards render the same format. Collapsing to a
 * bare basename would let a later issue's copy silently overwrite an
 * earlier issue's already-linked file — same run-log symptom we're
 * fixing here (a dangling/wrong image), except silent instead of a 404.
 *
 * Falls back to the original path (best-effort — the run log must never
 * fail a turn) if the copy fails for any reason.
 */
export async function persistDesignScreenshot(
  workspaceDir: string,
  designPath: string,
): Promise<string> {
  let historyPath = `design-history/${designPath.replace(/^design\//, '')}`;
  try {
    let dest = join(workspaceDir, historyPath);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(workspaceDir, designPath), dest);
    // Preserve the HTML mockup SOURCE alongside the flattened PNG. The PNG is
    // a picture of the design; the `.html` is the editable, re-renderable
    // truth behind it. It lives in scratch `design/` which the agent tidies
    // away, so copy its sibling into the durable `design-history/` too — a
    // best-effort archive (render-gate PNGs under design/render/ have no
    // sibling HTML; missing source is fine).
    let htmlSource = designPath.replace(/\.png$/i, '.html');
    if (htmlSource !== designPath) {
      try {
        let htmlDest = join(
          workspaceDir,
          `design-history/${htmlSource.replace(/^design\//, '')}`,
        );
        await mkdir(dirname(htmlDest), { recursive: true });
        await copyFile(join(workspaceDir, htmlSource), htmlDest);
      } catch {
        // No sibling HTML (e.g. a render-gate capture) — nothing to archive.
      }
    }
    return historyPath;
  } catch (err) {
    log.warn(
      `design-history copy failed for ${designPath}, linking it directly: ${String(err)}`,
    );
    return designPath;
  }
}

/**
 * Build an `AgentContext.onToolCall` handler that live-blogs an agent turn:
 *
 * - `post_update` calls (the agent's own commentary channel) → run-log
 *   entry + issue comment, verbatim.
 * - successful `screenshot_html` → a design entry with the image linked
 *   (full sync so the PNG itself reaches the realm).
 * - first native Write of each non-test `.gts` → "Writing <file>".
 * - failed validation checks → one "fixing" note per tool per 2 minutes.
 *
 * Everything is fire-and-forget; the writer serializes the actual file
 * writes. `sawDesign()` tells the loop whether the post-turn design
 * summary would duplicate what already streamed.
 */
export function createRunLogStreamHandler(opts: {
  runLog: RunLogWriter;
  addIssueComment?: (body: string) => Promise<void>;
  /**
   * Workspace root. Needed to durably copy `design/*.png` into
   * `design-history/` before linking it — `design/` is BUILD-turn scratch
   * the agent routinely deletes once a mockup is translated into a real
   * card, and the next workspace sync mirrors that deletion to the realm,
   * orphaning the run-log entry that already linked to it. `design-history/`
   * is never written or touched by the agent, so it never goes missing
   * locally and the sync never sees a reason to delete it remotely.
   */
  workspaceDir: string;
  /**
   * Absolute URL of the Issue this turn is working. Attached to every
   * streamed entry so each feed row links back to its issue.
   */
  issueUrl?: string;
}): {
  handler: (entry: {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    durationMs?: number;
  }) => void;
  sawDesign: () => boolean;
  /**
   * Card paths (`<Type>/<id>`, infra dirs excluded) of instance JSONs the
   * agent wrote this issue — native Writes never reach `result.toolCalls`,
   * so this is the loop's source for ship-moment card links.
   */
  instanceCardPaths: () => string[];
} {
  const EXCLUDED_INSTANCE_DIRS =
    /^(Issues|Projects|Boards|Knowledge(?: |%20)Articles|Spec|Validations|Runs|RunLogEntries|design|design-history|\.factory-scratch)\//;
  let sawDesign = false;
  let seenGtsWrites = new Set<string>();
  let lastCheckFailAt = new Map<string, number>();
  let instancePaths: string[] = [];

  let handler = (entry: {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
  }): void => {
    try {
      let tool = entry.tool.replace(/^mcp__[^_]+__/, '');

      if (tool === 'post_update' || tool.endsWith('post_update')) {
        let headline = String(entry.args.headline ?? '').trim();
        if (!headline) return;
        let body =
          typeof entry.args.body === 'string' && entry.args.body.trim()
            ? entry.args.body.trim()
            : undefined;
        let kind = POST_UPDATE_KINDS.has(String(entry.args.kind))
          ? String(entry.args.kind)
          : 'comment';
        void opts.runLog.append(
          [
            {
              kind: kind as RunLogEntryInput['kind'],
              headline,
              body,
              who: 'executor',
              issueUrl: opts.issueUrl,
            },
          ],
          undefined,
          { stream: true },
        );
        if (opts.addIssueComment) {
          void opts
            .addIssueComment(body ? `**${headline}**\n\n${body}` : headline)
            .catch(() => {});
        }
        return;
      }

      if (tool === 'screenshot_html' || tool.endsWith('screenshot_html')) {
        let result = entry.result as
          | { ok?: boolean; outputPath?: string }
          | undefined;
        if (!result?.ok || !result.outputPath) return;
        sawDesign = true;
        let designPath = result.outputPath;
        let name = designPath.replace(/^design\//, '').replace(/\.png$/, '');
        void (async () => {
          let imageCardPath = await persistDesignScreenshot(
            opts.workspaceDir,
            designPath,
          );
          // Full sync (not stream) so the screenshot file itself reaches the
          // realm before the entry links it.
          await opts.runLog.append([
            {
              kind: 'design',
              headline: `Design round: ${name}`,
              imageCardPath,
              who: 'executor',
              issueUrl: opts.issueUrl,
            },
          ]);
        })();
        return;
      }

      if (tool === 'Write' || tool === 'Edit') {
        let filePath = String(entry.args.file_path ?? entry.args.path ?? '');
        let normalized = filePath.replace(
          /^.*boxel-factory-workspaces\/[^/]+\//,
          '',
        );
        if (
          tool === 'Write' &&
          normalized.endsWith('.json') &&
          normalized.includes('/') &&
          !EXCLUDED_INSTANCE_DIRS.test(normalized)
        ) {
          let cardPath = normalized.replace(/\.json$/, '');
          if (!instancePaths.includes(cardPath)) {
            instancePaths.push(cardPath);
          }
          return;
        }
        if (!filePath.endsWith('.gts') || filePath.endsWith('.test.gts')) {
          return;
        }
        let name = filePath.split('/').pop() ?? filePath;
        if (seenGtsWrites.has(name)) return;
        seenGtsWrites.add(name);
        void opts.runLog.append(
          [
            {
              kind: 'progress',
              headline: `Writing ${name}`,
              body: 'Design accepted — translating the mockup into card code.',
              who: 'executor',
              issueUrl: opts.issueUrl,
            },
          ],
          undefined,
          { stream: true },
        );
        return;
      }

      let checkTool = CHECK_TOOLS.find((t) => tool === t || tool.endsWith(t));
      if (checkTool) {
        let result = entry.result as { status?: string } | undefined;
        if (result?.status !== 'failed') return;
        let now = Date.now();
        let last = lastCheckFailAt.get(checkTool) ?? 0;
        if (now - last < CHECK_FAIL_MIN_INTERVAL_MS) return;
        lastCheckFailAt.set(checkTool, now);
        void opts.runLog.append(
          [
            {
              kind: 'progress',
              headline: `${checkTool.replace('run_', '')} check failed — fixing`,
              // These mid-turn self-checks (run_lint/run_parse/run_evaluate/
              // run_instantiate) never write a realm artifact — only the
              // post-signal_done validation pipeline does, and that already
              // links its own Validations/ card (see issue-loop.ts). There's
              // nothing to link to here, so surface the actual failure text
              // instead of a bare, unclickable headline.
              body: summarizeCheckFailure(result),
              who: 'executor',
              issueUrl: opts.issueUrl,
            },
          ],
          undefined,
          { stream: true },
        );
      }
    } catch {
      // Streaming must never break the run.
    }
  };

  return {
    handler,
    sawDesign: () => sawDesign,
    instanceCardPaths: () => [...instancePaths],
  };
}

// ---------------------------------------------------------------------------
// Tool-call extraction helpers (used by the issue loop)
// ---------------------------------------------------------------------------

/**
 * Extract design-screenshot events from an agent turn's tool-call log:
 * the LAST successful screenshot per distinct output path (final state of
 * each surface), as ready-to-append entries with absolute image URLs.
 */
export async function designEntriesFromToolCalls(
  toolCalls: { tool: string; args: Record<string, unknown>; result: unknown }[],
  targetRealm: string,
  workspaceDir: string,
): Promise<RunLogEntryInput[]> {
  let latest = new Map<string, { outputPath: string }>();
  for (let call of toolCalls) {
    if (!call.tool.endsWith('screenshot_html')) continue;
    let result = call.result as { ok?: boolean; outputPath?: string } | null;
    if (!result?.ok || !result.outputPath) continue;
    latest.set(result.outputPath, { outputPath: result.outputPath });
  }
  return Promise.all(
    [...latest.values()].map(async ({ outputPath }) => {
      // persist before linking — see persistDesignScreenshot's doc comment.
      let imageCardPath = await persistDesignScreenshot(
        workspaceDir,
        outputPath,
      );
      return {
        kind: 'design' as const,
        headline: `Design round: ${outputPath.replace(/^design\//, '').replace(/\.png$/, '')}`,
        imageCardPath,
        imageUrl: new URL(imageCardPath, targetRealm).href,
      };
    }),
  );
}

/**
 * Extract "real card" paths from an agent turn's tool-call log: instance
 * JSON files written outside the tracker/validation/design folders. These
 * become card-ready entries that embed the live card.
 */
export function cardPathsFromToolCalls(
  toolCalls: { tool: string; args: Record<string, unknown>; result: unknown }[],
  limit = 3,
): string[] {
  const EXCLUDED =
    /^(Issues|Projects|Boards|Knowledge(?: |%20)Articles|Spec|Validations|Runs|RunLogEntries|design|design-history|\.factory-scratch)\//;
  let paths: string[] = [];
  for (let call of toolCalls) {
    if (call.tool !== 'Write') continue;
    let filePath = call.args?.file_path;
    if (typeof filePath !== 'string') continue;
    let normalized = filePath.replace(
      /^.*boxel-factory-workspaces\/[^/]+\//,
      '',
    );
    if (!normalized.endsWith('.json')) continue;
    if (EXCLUDED.test(normalized)) continue;
    if (!normalized.includes('/')) continue; // instances live in <Type>/<id>.json
    let cardPath = normalized.replace(/\.json$/, '');
    if (!paths.includes(cardPath)) {
      paths.push(cardPath);
    }
  }
  return paths.slice(0, limit);
}

// ---------------------------------------------------------------------------
// The RunLog CardDef module, written verbatim into the target realm
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The RunLog CardDef module, written verbatim into the target realm.
// Design language: Boxel Workspace (card-grid v2) — stage/surface paper,
// hairlines, mono micro-labels, Boxel-teal accent; ALL motion (scan line,
// pulse, arrival wash) is gated on status=running.
// ---------------------------------------------------------------------------

const RUN_LOG_GTS = `import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { gte, lt } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import FileDef from 'https://cardstack.com/base/file-api';
import {
  codeRef,
  realmURL,
  searchEntryWireQueryFromQuery,
  type Query,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

// @ts-expect-error import.meta is supported by the Boxel host
const here: string = import.meta.url;

function clock(value: Date | string | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

// Reveal-on-scroll feed window: fetch the last FEED_CAP entries once, reveal
// FEED_STEP at a time as the reader scrolls back (the workspace.gts pattern).
const FEED_STEP = 20;
const FEED_CAP = 100;

const KIND_GLYPHS: Record<string, string> = {
  phase: '◆',
  'issue-picked': '▸',
  'issue-done': '■',
  design: '✦',
  validation: '✓',
  'card-ready': '●',
  'run-done': '◼',
  status: '↻',
  'status-change': '⇄',
  iteration: '↻',
  blocked: '▲',
  comment: '❝',
  progress: '▹',
  decision: '⚑',
  'agent-spawn': '⚙',
  note: '·',
  monitor: '◉',
  telemetry: '≡',
};

class RunLogEntryEmbedded extends Component<typeof RunLogEntry> {
  @tracked nowMs = Date.now();
  #ticker: ReturnType<typeof setInterval>;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.#ticker = setInterval(() => {
      this.nowMs = Date.now();
    }, 30000);
    registerDestructor(this, () => clearInterval(this.#ticker));
  }

  get timeLabel() {
    return clock(this.args.model.postedAt);
  }
  get agoLabel() {
    let at = this.args.model.postedAt;
    if (!at) return '';
    let mins = Math.floor((this.nowMs - new Date(at).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm ago';
  }
  get glyph() {
    return KIND_GLYPHS[this.args.model.kind ?? ''] ?? '·';
  }
  get isShipMoment() {
    return this.args.model.kind === 'card-ready';
  }
  get isCompactLink() {
    let kind = this.args.model.kind ?? '';
    return (
      kind === 'validation' ||
      kind === 'status' ||
      kind === 'status-change' ||
      kind === 'iteration'
    );
  }
  <template>
    <div class='entry' data-kind={{@model.kind}}>
      <span class='t'>{{this.timeLabel}}
        <span class='ago'>{{this.agoLabel}}</span></span>
      <span class='chip'><span class='glyph'>{{this.glyph}}</span>
        {{@model.kind}}
        {{#if @model.who}}<span class='who'>{{@model.who}}</span>{{/if}}</span>
      <span class='h'>{{@model.headline}}</span>
      {{#if @model.body}}
        <div class='b'><@fields.body /></div>
      {{/if}}
      {{#if @model.image}}
        <div class='shot-frame'>
          <@fields.image @format='embedded' />
        </div>
      {{else if @model.imageUrl}}
        <div class='shot-frame'>
          <img class='shot-img' src={{@model.imageUrl}} alt={{@model.headline}} />
        </div>
      {{/if}}
      {{#if @model.card}}
        {{#if this.isShipMoment}}
          <div class='livecard'>
            <div class='shipped'>&#9679; shipped &mdash; live card</div>
            <div class='cardwrap'>
              <@fields.card @format='embedded' />
            </div>
          </div>
        {{else if this.isCompactLink}}
          <div class='showme showme-inline'>
            <span class='showme-label'>details</span>
            <span class='atom-chip'><@fields.card @format='atom' /></span>
          </div>
        {{else}}
          <div class='showme'>
            <span class='showme-label'>show me</span>
            <div class='cardwrap'>
              <@fields.card @format='embedded' />
            </div>
          </div>
        {{/if}}
      {{/if}}
      {{#if @model.issue}}
        {{! portal to the underlying truth: click through to the Issue this
          entry belongs to (and from there its project, spec, criteria) }}
        <div class='entry-links'>
          <span class='entry-link-label'>issue</span>
          <span class='atom-chip'><@fields.issue @format='atom' /></span>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .entry {
        display: grid;
        grid-template-columns: 52px 102px minmax(0, 1fr);
        gap: 0 14px;
        padding: 13px 0;
        border-bottom: 1px solid var(--rl-hairline, #eceef1);
        align-items: baseline;
        font-family: var(--rl-sans, var(--boxel-font-family, sans-serif));
      }
      .t {
        font: 500 11px var(--rl-mono, monospace);
        font-variant-numeric: tabular-nums;
        color: var(--rl-ink-meta, #a2a2ab);
      }
      .ago {
        display: block;
        font: 400 8.5px var(--rl-mono, monospace);
        letter-spacing: 0.02em;
        color: var(--rl-ink-ghost, #c0c0c7);
        margin-top: 2px;
        white-space: nowrap;
      }
      .chip {
        font: 600 8.5px var(--rl-mono, monospace);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--rl-ink-meta, #a2a2ab);
        white-space: nowrap;
      }
      .glyph {
        font-size: 10px;
        letter-spacing: 0;
        margin-right: 1px;
      }
      .who {
        display: block;
        margin-top: 2px;
        font: 500 8px var(--rl-mono, monospace);
        letter-spacing: 0.08em;
        color: var(--rl-ink-ghost, #c0c0c7);
      }
      .entry[data-kind='design'] .chip {
        color: var(--rl-attention, #d97706);
      }
      .entry[data-kind='card-ready'] .chip,
      .entry[data-kind='run-done'] .chip,
      .entry[data-kind='status'] .chip,
      .entry[data-kind='status-change'] .chip {
        color: var(--rl-interactive, #0c9d7c);
      }
      .entry[data-kind='blocked'] .chip {
        color: #ff5050;
      }
      .entry[data-kind='iteration'] .chip,
      .entry[data-kind='comment'] .chip,
      .entry[data-kind='monitor'] .chip,
      .entry[data-kind='telemetry'] .chip {
        color: var(--rl-ink-quiet, #5c5967);
      }
      /* Orchestrator meta-chatter reads smaller than build milestones. */
      .entry[data-kind='monitor'] .h,
      .entry[data-kind='telemetry'] .h {
        font-size: 12.5px;
        font-weight: 500;
        color: var(--rl-ink-quiet, #5c5967);
      }
      .showme {
        grid-column: 3;
        margin-top: 10px;
      }
      .showme-label {
        display: block;
        font: 700 9px var(--rl-mono, monospace);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--rl-ink-meta, #a2a2ab);
        margin-bottom: 6px;
      }
      .showme-inline {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .entry-links {
        grid-column: 3;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
      }
      .entry-link-label {
        font: 700 9px var(--rl-mono, monospace);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--rl-ink-meta, #a2a2ab);
      }
      .showme-inline .showme-label {
        display: inline;
        margin-bottom: 0;
      }
      .atom-chip :deep(.boxel-card-container) {
        border-radius: 5px;
        box-shadow: 0 0 0 1px var(--rl-border, #e2e8f0);
        cursor: pointer;
      }
      .h {
        font: 600 14px/1.35 var(--rl-sans, sans-serif);
        color: var(--rl-ink, #272330);
      }
      .b {
        grid-column: 3;
        font: 400 12.5px/1.5 var(--rl-sans, sans-serif);
        color: var(--rl-ink-quiet, #5c5967);
        margin-top: 3px;
      }
      .shot-frame {
        grid-column: 3;
        margin-top: 10px;
        max-width: 540px;
        border: 1px solid var(--rl-border, #e2e8f0);
        border-radius: 6px;
        overflow: hidden;
        background: var(--rl-surface, #fff);
      }
      .shot-frame :deep(.boxel-card-container) {
        border-radius: 0;
        box-shadow: none;
      }
      .shot-img {
        width: 100%;
        display: block;
      }
      .livecard {
        grid-column: 3;
        margin-top: 10px;
        max-width: 540px;
      }
      .shipped {
        font: 700 9px var(--rl-mono, monospace);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--rl-interactive, #0c9d7c);
        margin-bottom: 6px;
      }
      .cardwrap :deep(.boxel-card-container) {
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(28, 28, 50, 0.05);
      }
    </style>
  </template>
}

export class RunLogEntry extends CardDef {
  static displayName = 'Run Log Entry';
  // Each entry is its OWN card instance (not a containsMany element), so a
  // new entry is one small file write — never a rewrite of a growing log.
  // The RunLog feed is a live query over these, scoped by runId.
  @field runId = contains(StringField);
  // Monotonic per-run sequence — the query's stable sort key (postedAt can
  // tie within a second under rapid appends).
  @field seq = contains(NumberField);
  @field kind = contains(StringField);
  @field postedAt = contains(DatetimeField);
  @field headline = contains(StringField);
  @field body = contains(MarkdownField);
  @field imageUrl = contains(StringField);
  /** Who is speaking: orchestrator | executor | validator | an agent name. */
  @field who = contains(StringField);
  // File cards (PngDef etc.) descend from FileDef, NOT CardDef — a
  // CardDef-typed link rejects them at field validation.
  @field image = linksTo(() => FileDef);
  @field card = linksTo(() => CardDef);
  // The Issue this entry belongs to — the portal to the underlying truth
  // (project, spec, acceptance criteria, built card).
  @field issue = linksTo(() => CardDef);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: RunLogEntry) {
      return this.headline ?? 'Run log entry';
    },
  });

  static embedded = RunLogEntryEmbedded;
  // Fitted just reuses the embedded surface — entries are only ever rendered
  // in the feed (embedded); fitted exists to satisfy the 3-format contract.
  static fitted = RunLogEntryEmbedded;
  static isolated = RunLogEntryEmbedded;
}

class RunLogIsolated extends Component<typeof RunLog> {
  @tracked nowMs = Date.now();
  #ticker: ReturnType<typeof setInterval>;
  #destroyed = false;

  // The feed renders a stable window of the fetched tail (newest-first,
  // capped at FEED_CAP). Two independent edges bound it:
  //
  //  - newCount (head): how many just-arrived entries are BUFFERED, not
  //    rendered. A live run prepends at index 0; rendering them would shove
  //    the reader's content down. Instead they're held behind a subtle
  //    "N new" pill and only revealed on click (or auto, if the reader is
  //    already at the top watching live) — so passive updates never shift
  //    what's on screen.
  //  - feedShown (tail): reveal-on-scroll window (workspace.gts pattern);
  //    grows by FEED_STEP as the bottom sentinel comes into view.
  //
  // Rendered rows are entries[newCount .. newCount + feedShown).
  @tracked feedShown = FEED_STEP;
  @tracked feedFetched = 0;
  @tracked newCount = 0;
  @tracked private atTop = true;
  @tracked private anchorId: string | null = null;
  private topSentinel: HTMLElement | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.#ticker = setInterval(() => {
      this.nowMs = Date.now();
    }, 1000);
    registerDestructor(this, () => {
      this.#destroyed = true;
      clearInterval(this.#ticker);
    });
  }

  // End index of the rendered window (exclusive).
  get windowEnd(): number {
    return this.newCount + this.feedShown;
  }
  // More rows are fetched below the window — show the tail sentinel.
  get moreFeed(): boolean {
    return this.feedFetched > this.windowEnd;
  }
  // The whole capped window is revealed — show the terminal note.
  get feedAtCap(): boolean {
    return this.feedFetched >= FEED_CAP && this.windowEnd >= this.feedFetched;
  }

  // Reveal the buffered head: acknowledge the newest entry and jump to the
  // top. User-initiated, so the scroll-to-top is expected, not a jarring
  // shift. Auto-reconcile (below) then recomputes newCount to 0.
  showNew = () => {
    this.atTop = true;
    this.newCount = 0;
    this.topSentinel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Reconcile the head buffer against the live entry stream. When the reader
  // is at the top, stay caught up — acknowledge the newest and buffer
  // nothing, so a live watcher sees updates immediately. When scrolled away,
  // hold every entry newer than the anchor (the newest they've seen) so the
  // visible rows never move; newCount drives the pill.
  //
  // Modifier bodies run inside the render transaction, and this state feeds
  // values the template consumed earlier in the same pass (newCount,
  // windowEnd) — a synchronous tracked write here trips Glimmer's
  // backtracking assertion and error-tiles the prerendered card. So the
  // reconcile is deferred to a microtask (outside the render), and every
  // write is change-guarded so a re-run with identical values settles
  // instead of revalidating forever.
  captureFeed = modifier(
    (_el: HTMLElement, [entries]: [{ id: string }[]]) => {
      void Promise.resolve().then(() => {
        if (this.#destroyed) {
          return;
        }
        if (this.feedFetched !== entries.length) {
          this.feedFetched = entries.length;
        }
        if (entries.length === 0) {
          if (this.newCount !== 0) {
            this.newCount = 0;
          }
          return;
        }
        let newestId = entries[0].id;
        if (this.anchorId === null || this.atTop) {
          if (this.anchorId !== newestId) {
            this.anchorId = newestId;
          }
          if (this.newCount !== 0) {
            this.newCount = 0;
          }
          return;
        }
        let idx = entries.findIndex((e) => e.id === this.anchorId);
        // Anchor still present → entries before it are new. Anchor fell off
        // the capped window → can't hold what we can't show; re-anchor to
        // newest.
        if (idx < 0) {
          this.anchorId = newestId;
          if (this.newCount !== 0) {
            this.newCount = 0;
          }
        } else if (this.newCount !== idx) {
          this.newCount = idx;
        }
      });
    },
  );

  // Track whether the feed is scrolled to its top, to decide auto-reveal vs
  // buffer. A top sentinel just below the masthead drives it.
  watchFeedTop = modifier((element: HTMLElement) => {
    this.topSentinel = element;
    let root = element.closest('.scroll-container');
    let observer = new IntersectionObserver(
      ([entry]) => {
        this.atTop = entry.isIntersecting;
      },
      { root, rootMargin: '0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      this.topSentinel = null;
    };
  });

  // Reveal the next FEED_STEP when the tail sentinel scrolls near the feed
  // bottom. Re-arm after each reveal: observe() delivers a fresh async
  // notification, so a still-visible sentinel keeps paging until caught up.
  watchFeedEnd = modifier((element: HTMLElement) => {
    let root = element.closest('.scroll-container');
    let observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.feedShown = Math.min(
            this.feedShown + FEED_STEP,
            this.feedFetched - this.newCount,
          );
          observer.unobserve(element);
          observer.observe(element);
        }
      },
      { root, rootMargin: '160px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  get running() {
    return this.args.model.status === 'running';
  }
  get statusWord() {
    return this.running ? 'LIVE' : (this.args.model.status ?? '');
  }
  get elapsedLabel() {
    let started = this.args.model.startedAt;
    if (!started) return '';
    let end = this.running
      ? this.nowMs
      : new Date(this.args.model.finishedAt ?? started).getTime();
    let secs = Math.max(0, Math.floor((end - new Date(started).getTime()) / 1000));
    let h = String(Math.floor(secs / 3600)).padStart(2, '0');
    let m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    let sec = String(secs % 60).padStart(2, '0');
    return h + ':' + m + ':' + sec;
  }
  get warmingUp() {
    // The "setup phase" hint shows only during bootstrap — no counters
    // needed (the rail facets below are query-backed).
    return (
      this.running &&
      (!this.args.model.nowWorkingOn ||
        this.args.model.nowWorkingOn === 'Bootstrapping')
    );
  }
  // ---- live feed query: every RunLogEntry for THIS run, newest first ----
  get entryRef() {
    return codeRef(here, './run-log', 'RunLogEntry');
  }
  get realms(): string[] {
    let url = this.args.model?.[realmURL];
    return url ? [url.href] : [];
  }
  // ---- rail facets: query-backed counts, one lightweight count-query per
  // facet (page:size:1 → results.meta.page.total), so the numbers reflect the
  // actual RunLogEntry cards instead of a maintained counter that can drift. --
  countWireQuery(kind: string): SearchEntryWireQuery {
    let ref = this.entryRef;
    let q = searchEntryWireQueryFromQuery({
      filter: {
        on: ref,
        eq: { runId: this.args.model.runId ?? '', kind },
      },
      page: { size: 1 },
    });
    return { ...q, realms: this.realms };
  }
  get cardsReadyWireQuery() {
    return this.countWireQuery('card-ready');
  }
  get designRoundsWireQuery() {
    return this.countWireQuery('design');
  }
  get validationsWireQuery() {
    return this.countWireQuery('validation');
  }
  get issuesDoneWireQuery() {
    return this.countWireQuery('issue-done');
  }
  get facets() {
    return [
      { label: 'Cards ready', accent: true, query: this.cardsReadyWireQuery },
      { label: 'Design rounds', accent: false, query: this.designRoundsWireQuery },
      { label: 'Validations', accent: false, query: this.validationsWireQuery },
      { label: 'Issues done', accent: false, query: this.issuesDoneWireQuery },
    ];
  }
  get entriesQuery(): Query {
    let ref = this.entryRef;
    // on: ref scopes the eq predicate to RunLogEntry AND filters by runId;
    // custom-field sort (seq) also requires on: ref. Newest-first and BOUNDED
    // (cardinal rule 15): one fetch of the recent tail, capped at FEED_CAP;
    // the template reveals it FEED_STEP at a time on scroll (no re-query).
    // Rendered in query order (no column-reverse), newest on top.
    return {
      filter: { on: ref, eq: { runId: this.args.model.runId ?? '' } },
      sort: [{ by: 'seq', on: ref, direction: 'desc' }],
      page: { size: FEED_CAP },
    };
  }
  get entriesWireQuery(): SearchEntryWireQuery {
    let q = searchEntryWireQueryFromQuery(this.entriesQuery);
    return {
      ...q,
      realms: this.realms,
      filter: {
        ...q.filter,
        eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'embedded' } } },
      },
    };
  }
  <template>
    <article class='runlog' data-status={{@model.status}}>
      {{#if this.running}}<div class='scanline'></div>{{/if}}
      <header class='masthead'>
        <span class='signage'>Factory &middot; Run Log</span>
        <h1 class='run-title'>{{@model.runTitle}}</h1>
        <div class='live-block'>
          {{#if this.running}}<span class='live-dot'></span>{{/if}}
          <span class='live-word'>{{this.statusWord}}</span>
          <span class='started'>{{this.elapsedLabel}}</span>
        </div>
      </header>
      <div class='nowband'>
        <span class='k'>Now</span>
        {{#if this.running}}
          <span class='throbber'><i></i><i></i><i></i></span>
        {{/if}}
        <span class='now-item'>{{@model.nowWorkingOn}}</span>
        {{#if this.warmingUp}}
          <span class='now-hint'>setup phase — first design round lands in a few minutes</span>
        {{/if}}
        <span class='next-wrap'>
          <span class='k'>Next</span>
          <span class='next-item'>{{if @model.upNext @model.upNext '—'}}</span>
        </span>
      </div>
      <div class='body-grid'>
        <aside class='rail'>
          {{! Each facet is a query-backed count tile: a page:size:1 count
            query over RunLogEntry (this run, this kind) whose
            results.meta.page.total is the live, drift-free number — no
            maintained counter. }}
          {{#each this.facets as |facet|}}
            <div class='stat'>
              <div class='n {{if facet.accent "accent"}}'>
                {{#if @context.searchResultsComponent}}
                  <@context.searchResultsComponent
                    @query={{facet.query}}
                    @mode='none'
                    as |results|
                  >
                    {{if results.isLoading '·' results.meta.page.total}}
                  </@context.searchResultsComponent>
                {{/if}}
              </div>
              <div class='l'>{{facet.label}}</div>
            </div>
          {{/each}}
        </aside>
        <div class='feed'>
          {{! Top sentinel: drives the at-top detection that decides whether
            live arrivals auto-reveal or buffer behind the pill. }}
          <div class='feed-top' {{this.watchFeedTop}}></div>
          {{! Buffered live arrivals — subtle, non-shifting, click to reveal.
            Only shows when the reader has scrolled away from the head. }}
          {{#if this.newCount}}
            <button
              class='newpill'
              type='button'
              {{on 'click' this.showNew}}
            >
              <span class='newpill-arrow'>&uarr;</span>
              {{this.newCount}}
              new
            </button>
          {{/if}}
          {{! newest-first query order, rendered top-to-bottom; the intro
            explainer follows the entries so it settles at the bottom }}
          {{#if @context.searchResultsComponent}}
            <@context.searchResultsComponent
              @query={{this.entriesWireQuery}}
              @mode='hover'
              as |results|
            >
              {{#if results.isLoading}}
                <div class='feed-loading'>Loading the live feed…</div>
              {{/if}}
              {{! Render only the stable window [newCount, windowEnd): head
                entries below newCount are buffered (see the pill), tail
                beyond windowEnd waits for the scroll sentinel. }}
              {{#each results.entries key='id' as |entry index|}}
                {{#if (lt index this.windowEnd)}}
                  {{#if (gte index this.newCount)}}
                    <entry.component />
                  {{/if}}
                {{/if}}
              {{else}}
                {{#unless results.isLoading}}
                  <div class='feed-empty'>No entries yet — the first
                    milestone lands here shortly.</div>
                {{/unless}}
              {{/each}}
              {{! Reconcile the head buffer + fetched count from the live
                entry stream (modifiers run render-safe). }}
              <div
                class='meta-sink'
                {{this.captureFeed results.entries}}
              ></div>
            </@context.searchResultsComponent>
            {{#if this.moreFeed}}
              {{! reveal-on-scroll: the sentinel reveals the next batch }}
              <div class='feed-tail' {{this.watchFeedEnd}}>
                <span class='feed-tail-label'>Showing
                  {{this.feedShown}}
                  of
                  {{this.feedFetched}}</span>
              </div>
            {{else if this.feedAtCap}}
              <p class='feed-end-note'>Showing the last {{this.feedFetched}}
                entries.</p>
            {{/if}}
          {{/if}}
          {{#if this.running}}
            <div class='intro'>
              <span class='intro-signage'>How this works</span>
              <p class='intro-copy'>
                The factory is building this realm live. It reads the brief,
                plans the card family, mocks each card in HTML first,
                critiques and revises the design, then writes the real code
                — every milestone lands here the moment it happens, newest
                at the top.
              </p>
              <div class='legend'>
                <span class='lg'><i class='dot d-design'></i> design round</span>
                <span class='lg'><i class='dot d-val'></i> validation</span>
                <span class='lg'><i class='dot d-ready'></i> card ready</span>
                <span class='lg'><i class='dot d-issue'></i> issue progress</span>
              </div>
            </div>
          {{/if}}
        </div>
      </div>
    </article>
    <style scoped>
      .runlog {
        --rl-ink: #272330;
        --rl-ink-quiet: #5c5967;
        --rl-ink-meta: #a2a2ab;
        --rl-ink-ghost: #c0c0c7;
        --rl-stage: var(--background, #f7f8fa);
        --rl-surface: #ffffff;
        --rl-track: #eef0f4;
        --rl-border: #e2e8f0;
        --rl-hairline: #eceef1;
        --rl-interactive: var(--primary, #0c9d7c);
        --rl-live: #00c495;
        --rl-accent: var(--boxel-teal, #00ffba);
        --rl-attention: #d97706;
        --rl-mono: var(--boxel-monospace-font-family, 'IBM Plex Mono', monospace);
        --rl-sans: var(--boxel-font-family, 'IBM Plex Sans', sans-serif);
        position: relative;
        container-type: inline-size;
        container-name: runlog;
        min-height: 100%;
        background: var(--rl-stage);
        color: var(--rl-ink);
        font-family: var(--rl-sans);
      }
      .scanline {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        z-index: 2;
        background: linear-gradient(
          90deg,
          transparent,
          var(--rl-accent),
          var(--rl-live),
          transparent
        );
        background-size: 200% 100%;
        animation: scan 2.4s linear infinite;
      }
      @keyframes scan {
        from { background-position: 200% 0; }
        to { background-position: -200% 0; }
      }
      @keyframes softpulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
      .masthead {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 22px 14px;
        background: var(--rl-surface);
        border-bottom: 1px solid var(--rl-hairline);
      }
      .signage {
        padding: 3px 8px;
        border: 1px solid var(--rl-border);
        border-radius: 5px;
        font: 600 9.5px var(--rl-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--rl-ink-meta);
        white-space: nowrap;
      }
      .run-title {
        margin: 0;
        font: 650 20px/1.2 var(--rl-sans);
        letter-spacing: -0.01em;
      }
      .live-block {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--rl-live);
        animation: softpulse 2s ease-in-out infinite;
      }
      .live-word {
        font: 700 10.5px var(--rl-mono);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--rl-interactive);
      }
      .runlog[data-status='failed'] .live-word { color: #ff5050; }
      .started {
        font: 500 11px var(--rl-mono);
        font-variant-numeric: tabular-nums;
        color: var(--rl-ink-meta);
      }
      .nowband {
        display: flex;
        align-items: baseline;
        gap: 14px;
        padding: 14px 22px;
        background: var(--rl-surface);
        border-bottom: 1px solid var(--rl-hairline);
      }
      .k {
        font: 600 9.5px var(--rl-mono);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--rl-ink-meta);
        flex: none;
      }
      .throbber {
        display: inline-flex;
        align-items: flex-end;
        gap: 2.5px;
        height: 16px;
        align-self: center;
        flex: none;
      }
      .throbber i {
        width: 3px;
        border-radius: 1.5px;
        background: var(--rl-live);
        animation: eq 1.1s ease-in-out infinite;
      }
      .throbber i:nth-child(1) { height: 8px; }
      .throbber i:nth-child(2) { height: 14px; animation-delay: 0.18s; }
      .throbber i:nth-child(3) { height: 10px; animation-delay: 0.36s; }
      @keyframes eq {
        0%, 100% { transform: scaleY(0.55); }
        50% { transform: scaleY(1); }
      }
      .now-item {
        font: 400 24px/1.15 var(--rl-sans);
        letter-spacing: -0.015em;
        min-width: 0;
      }
      .next-wrap {
        margin-left: auto;
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .next-item {
        font: 400 13px var(--rl-sans);
        color: var(--rl-ink-quiet);
      }
      .body-grid {
        display: grid;
        grid-template-columns: 188px minmax(0, 1fr);
      }
      .rail {
        padding: 20px 0 26px 22px;
        border-right: 1px solid var(--rl-hairline);
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .stat .n {
        font: 300 40px/1 var(--rl-sans);
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .stat .n.accent { color: var(--rl-interactive); }
      .stat .l {
        font: 600 9px var(--rl-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--rl-ink-meta);
        margin-top: 5px;
      }
      .feed {
        display: flex;
        flex-direction: column;
        padding: 6px 22px 22px 24px;
      }
      /* Each entry renders through the host search-results component, which
         wraps it in embedded CardContainer chrome — a boundaried box with a
         fixed ~78px height and overflow:hidden. That clips any entry tall
         enough to have a body and pads short ones with dead space. Own the
         container: let each entry size to its content, and drop the per-entry
         card frame so the feed reads as flat rows (the .entry template draws
         its own dividers), not a stack of little cards. */
      .feed :deep(.boxel-card-container.embedded-format) {
        height: auto;
        min-height: 0;
        max-height: none;
        overflow: visible;
        border: none;
        border-radius: 0;
        box-shadow: none;
        background: transparent;
      }
      /* Zero-DOM sink: only exists to run the captureFeed modifier. */
      .meta-sink {
        display: none;
      }
      /* Zero-height marker at the head; drives at-top detection. */
      .feed-top {
        height: 0;
        margin: 0;
        pointer-events: none;
      }
      /* Buffered-arrivals pill. Sticky so it floats at the top of the
         viewport while the reader is scrolled away — new items are held out
         of the flow (never rendered until revealed), so nothing shifts; this
         is the only cue. Subtle by default, accent on hover. */
      .newpill {
        position: sticky;
        top: 8px;
        z-index: 6;
        align-self: center;
        margin: 2px 0 8px;
        padding: 5px 13px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--rl-border);
        border-radius: 999px;
        background: color-mix(in srgb, var(--rl-surface) 88%, transparent);
        backdrop-filter: blur(6px);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
        color: var(--rl-ink-quiet);
        font: 600 10.5px var(--rl-mono);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        cursor: pointer;
        opacity: 0.82;
        transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .newpill:hover {
        opacity: 1;
        color: var(--rl-accent);
        border-color: var(--rl-accent);
      }
      .newpill-arrow {
        font-size: 12px;
        line-height: 1;
      }
      /* Tail sentinel — the IntersectionObserver target that pages back. */
      .feed-tail {
        display: flex;
        justify-content: center;
        padding: 14px 0 4px;
      }
      .feed-tail-label {
        font: 500 10px var(--rl-mono);
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--rl-ink-meta);
        opacity: 0.7;
      }
      .feed-end-note {
        margin: 14px 0 2px;
        text-align: center;
        font: 500 10px var(--rl-mono);
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--rl-ink-meta);
        opacity: 0.7;
      }
      .intro {
        margin-top: 16px;
        padding: 14px 16px;
        border: 1px dashed var(--rl-border);
        border-radius: 8px;
        background: var(--rl-surface);
      }
      .intro-signage {
        font: 600 9px var(--rl-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--rl-ink-meta);
      }
      .intro-copy {
        margin: 6px 0 10px;
        font: 400 12.5px/1.55 var(--rl-sans);
        color: var(--rl-ink-quiet);
        max-width: 60ch;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
      }
      .lg {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: 500 9.5px var(--rl-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--rl-ink-meta);
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        display: inline-block;
      }
      .d-design { background: var(--rl-attention); }
      .d-val { background: var(--rl-live); }
      .d-ready { background: var(--rl-interactive); }
      .d-issue { background: var(--rl-ink-ghost); }
      .now-hint {
        align-self: center;
        font: 400 12px var(--rl-sans);
        color: var(--rl-ink-meta);
      }
      .feed > :first-child {
        border-bottom: 0;
      }
      /* newest entry gets a one-shot teal arrival wash while live */
      .runlog[data-status='running'] .feed > :last-child {
        animation: arrive 3s ease-out 1;
      }
      @keyframes arrive {
        0% { background: rgba(0, 255, 186, 0.14); }
        100% { background: transparent; }
      }
      @container runlog (max-width: 700px) {
        .body-grid { grid-template-columns: 1fr; }
        .rail {
          flex-direction: row;
          gap: 26px;
          padding: 16px 22px;
          border-right: 0;
          border-bottom: 1px solid var(--rl-hairline);
        }
        .stat .n { font-size: 26px; }
        .now-item { font-size: 18px; }
        .next-wrap { display: none; }
      }
    </style>
  </template>
}

export class RunLog extends CardDef {
  static displayName = 'Run Log';
  static prefersWideFormat = true;
  @field runTitle = contains(StringField);
  @field status = contains(StringField);
  @field nowWorkingOn = contains(StringField);
  @field upNext = contains(StringField);
  @field startedAt = contains(DatetimeField);
  @field finishedAt = contains(DatetimeField);
  // Scopes the live feed query to THIS run's entries.
  @field runId = contains(StringField);
  // Lightweight milestone counters (feed entries are separate cards now;
  // the writer bumps these instead of scanning a containsMany array).
  @field entryCount = contains(NumberField);
  @field cardsReadyCount = contains(NumberField);
  @field designRoundsCount = contains(NumberField);
  @field validationsGreenCount = contains(NumberField);
  @field issuesDoneCount = contains(NumberField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: RunLog) {
      return this.runTitle ? 'Run log — ' + this.runTitle : 'Run log';
    },
  });

  static isolated = RunLogIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    get running() {
      return this.args.model.status === 'running';
    }
    get shipped() {
      return this.args.model.cardsReadyCount ?? 0;
    }
    get rounds() {
      return this.args.model.designRoundsCount ?? 0;
    }
    <template>
      <div class='row' data-status={{@model.status}}>
        {{#if this.running}}<span class='dot'></span>{{/if}}
        <div class='mid'>
          <div class='nm'>{{@model.runTitle}}</div>
          <div class='now'>Now: {{@model.nowWorkingOn}}</div>
        </div>
        <span class='counts'><em>{{this.shipped}}</em> shipped &middot; {{this.rounds}} rounds</span>
      </div>
      <style scoped>
        .row {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 11px 14px;
          font-family: var(--boxel-font-family, 'IBM Plex Sans', sans-serif);
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #00c495;
          flex: none;
          animation: softpulse 2s ease-in-out infinite;
        }
        @keyframes softpulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .mid { flex: 1; min-width: 0; }
        .nm { font: 600 13.5px/1.3 var(--boxel-font-family, sans-serif); }
        .now {
          font: 400 11.5px/1.4 var(--boxel-font-family, sans-serif);
          color: #5c5967;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .counts {
          margin-left: auto;
          font: 500 10.5px var(--boxel-monospace-font-family, monospace);
          font-variant-numeric: tabular-nums;
          color: #a2a2ab;
          white-space: nowrap;
        }
        .counts em { font-style: normal; color: #0c9d7c; }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get running() {
      return this.args.model.status === 'running';
    }
    get shipped() {
      return this.args.model.cardsReadyCount ?? 0;
    }
    <template>
      <div class='fit' data-status={{@model.status}}>
        <span class='dot'></span>
        <span class='nm'>{{@model.runTitle}}</span>
        <span class='now'>{{@model.nowWorkingOn}}</span>
        <span class='count'>{{this.shipped}}</span>
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          font-family: var(--boxel-font-family, 'IBM Plex Sans', sans-serif);
        }
        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #00c495;
          flex: none;
        }
        .fit[data-status='running'] .dot {
          animation: softpulse 2s ease-in-out infinite;
        }
        .fit[data-status='completed'] .dot { background: #0c9d7c; }
        .fit[data-status='failed'] .dot { background: #ff5050; }
        @keyframes softpulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .nm {
          font: 600 12px/1.3 var(--boxel-font-family, sans-serif);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .now, .count { display: none; }
        @container fitted-card (min-width: 200px) {
          .now {
            display: block;
            flex: 1;
            min-width: 0;
            font: 400 10.5px/1.3 var(--boxel-font-family, sans-serif);
            color: #5c5967;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .count {
            display: block;
            font: 500 10px var(--boxel-monospace-font-family, monospace);
            font-variant-numeric: tabular-nums;
            color: #0c9d7c;
          }
        }
        @container fitted-card (min-height: 170px) {
          .fit {
            flex-direction: column;
            align-items: flex-start;
            justify-content: space-between;
            padding: 12px;
          }
          .nm { font-size: 13.5px; white-space: normal; }
          .now { flex: none; white-space: normal; }
        }
      </style>
    </template>
  };
}
`;
