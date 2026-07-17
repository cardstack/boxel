/**
 * Run log — the live-blog surface for a factory run.
 *
 * The factory writes a `run-log.gts` CardDef plus one `Runs/<slug>.json`
 * instance into the TARGET realm and appends entries as real events happen
 * (issue picked, design screenshots produced, validation results, card
 * ready, run done). The operator watches the RunLog card in the realm —
 * newest entry first — instead of tailing a terminal. Design screenshots
 * embed as images the moment they exist; the REAL card embeds (live,
 * rendered) the moment its first instance lands, via a `linksTo` on the
 * entry.
 *
 * Entries are appended (stable `entries.N.card` relationship indexes) and
 * displayed newest-first via `column-reverse` in the template, so appends
 * never rewrite existing relationship keys.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { logger } from './logger.ts';

const log = logger('run-log');

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
    | 'iteration'
    | 'comment'
    | 'blocked'
    | 'note';
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
}

export interface RunLogWriterOptions {
  workspaceDir: string;
  targetRealm: string;
  runSlug: string;
  runTitle: string;
  /** Push the workspace to the realm (the loop's shared sync gate). */
  syncWorkspace: () => Promise<{ ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export class RunLogWriter {
  private opts: RunLogWriterOptions;
  private instancePath: string;

  constructor(opts: RunLogWriterOptions) {
    this.opts = opts;
    this.instancePath = join(opts.workspaceDir, 'Runs', `${opts.runSlug}.json`);
  }

  /** Idempotent: writes the CardDef module if missing and creates or re-arms the instance. */
  async start(): Promise<void> {
    try {
      let modulePath = join(this.opts.workspaceDir, 'run-log.gts');
      let moduleExists = await fileExists(modulePath);
      if (!moduleExists) {
        await writeFile(modulePath, RUN_LOG_GTS, 'utf8');
      }

      if (await fileExists(this.instancePath)) {
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
            entries: [
              {
                kind: 'phase',
                at: new Date().toISOString(),
                headline: 'Run started',
                body: null,
                imageUrl: null,
              },
            ],
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
      await this.sync();
    } catch (error) {
      // The run log must never take down a run.
      log.warn(`run-log start failed: ${String(error)}`);
    }
  }

  /** Append one or more entries in a single write+sync. */
  async append(
    entries: RunLogEntryInput[],
    updates?: { nowWorkingOn?: string; upNext?: string },
  ): Promise<void> {
    if (entries.length === 0 && !updates) return;
    try {
      let doc = JSON.parse(await readFile(this.instancePath, 'utf8'));
      let attrs = doc.data.attributes;
      let rels: Record<string, unknown> = doc.data.relationships ?? {};

      for (let entry of entries) {
        let index = attrs.entries.length;
        attrs.entries.push({
          kind: entry.kind,
          at: new Date().toISOString(),
          headline: entry.headline,
          body: entry.body ?? null,
          imageUrl: entry.imageUrl ?? null,
        });
        if (entry.cardPath) {
          rels[`entries.${index}.card`] = {
            links: { self: `../${entry.cardPath}` },
          };
        }
        if (entry.imageCardPath) {
          rels[`entries.${index}.image`] = {
            links: { self: `../${entry.imageCardPath}` },
          };
        }
      }
      if (updates?.nowWorkingOn !== undefined) {
        attrs.nowWorkingOn = updates.nowWorkingOn;
      }
      if (updates?.upNext !== undefined) {
        attrs.upNext = updates.upNext;
      }
      doc.data.relationships = rels;
      await writeFile(this.instancePath, JSON.stringify(doc, null, 2), 'utf8');
      await this.sync();
    } catch (error) {
      log.warn(`run-log append failed: ${String(error)}`);
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
      await this.patch({ status });
    } catch (error) {
      log.warn(`run-log finish failed: ${String(error)}`);
    }
  }

  private async patch(updates: { status?: string }): Promise<void> {
    let doc = JSON.parse(await readFile(this.instancePath, 'utf8'));
    if (updates.status) {
      doc.data.attributes.status = updates.status;
    }
    await writeFile(this.instancePath, JSON.stringify(doc, null, 2), 'utf8');
    await this.sync();
  }

  private async sync(): Promise<void> {
    let result = await this.opts.syncWorkspace();
    if (!result.ok) {
      log.warn(`run-log sync failed: ${result.error ?? 'unknown'}`);
    }
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

// ---------------------------------------------------------------------------
// Tool-call extraction helpers (used by the issue loop)
// ---------------------------------------------------------------------------

/**
 * Extract design-screenshot events from an agent turn's tool-call log:
 * the LAST successful screenshot per distinct output path (final state of
 * each surface), as ready-to-append entries with absolute image URLs.
 */
export function designEntriesFromToolCalls(
  toolCalls: { tool: string; args: Record<string, unknown>; result: unknown }[],
  targetRealm: string,
): RunLogEntryInput[] {
  let latest = new Map<string, RunLogEntryInput>();
  for (let call of toolCalls) {
    if (!call.tool.endsWith('screenshot_html')) continue;
    let result = call.result as { ok?: boolean; outputPath?: string } | null;
    if (!result?.ok || !result.outputPath) continue;
    latest.set(result.outputPath, {
      kind: 'design',
      headline: `Design round: ${result.outputPath.replace(/^design\//, '').replace(/\.png$/, '')}`,
      imageCardPath: result.outputPath,
      imageUrl: new URL(result.outputPath, targetRealm).href,
    });
  }
  return [...latest.values()];
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
    /^(Issues|Projects|Boards|Knowledge[ %]20?Articles|Spec|Validations|Runs|design)\//;
  let paths: string[] = [];
  for (let call of toolCalls) {
    if (call.tool !== 'Write') continue;
    let filePath = call.args?.file_path;
    if (typeof filePath !== 'string') continue;
    let normalized = filePath.replace(/^.*boxel-factory-workspaces\/[^/]+\//, '');
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
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import FileDef from 'https://cardstack.com/base/file-api';

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

class RunLogEntry extends FieldDef {
  static displayName = 'Run Log Entry';
  @field kind = contains(StringField);
  @field at = contains(DatetimeField);
  @field headline = contains(StringField);
  @field body = contains(MarkdownField);
  @field imageUrl = contains(StringField);
  // File cards (PngDef etc.) descend from FileDef, NOT CardDef — a
  // CardDef-typed link rejects them at field validation.
  @field image = linksTo(() => FileDef);
  @field card = linksTo(() => CardDef);

  static embedded = class Embedded extends Component<typeof this> {
    get timeLabel() {
      return clock(this.args.model.at);
    }
    get isShipMoment() {
      return this.args.model.kind === 'card-ready';
    }
    <template>
      <div class='entry' data-kind={{@model.kind}}>
        <span class='t'>{{this.timeLabel}}</span>
        <span class='chip'>{{@model.kind}}</span>
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
          {{else}}
            <div class='showme'>
              <span class='showme-label'>show me</span>
              <@fields.card @format='atom' />
            </div>
          {{/if}}
        {{/if}}
      </div>
      <style scoped>
        .entry {
          display: grid;
          grid-template-columns: 52px 88px minmax(0, 1fr);
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
        .chip {
          font: 600 8.5px var(--rl-mono, monospace);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--rl-ink-meta, #a2a2ab);
          white-space: nowrap;
        }
        .entry[data-kind='design'] .chip {
          color: var(--rl-attention, #d97706);
        }
        .entry[data-kind='card-ready'] .chip,
        .entry[data-kind='run-done'] .chip,
        .entry[data-kind='status'] .chip {
          color: var(--rl-interactive, #0c9d7c);
        }
        .entry[data-kind='blocked'] .chip {
          color: #ff5050;
        }
        .entry[data-kind='iteration'] .chip,
        .entry[data-kind='comment'] .chip {
          color: var(--rl-ink-quiet, #5c5967);
        }
        .showme {
          grid-column: 3;
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .showme-label {
          font: 700 9px var(--rl-mono, monospace);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--rl-ink-meta, #a2a2ab);
        }
        .showme :deep(.boxel-card-container) {
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
  };
}

export class RunLog extends CardDef {
  static displayName = 'Run Log';
  static prefersWideFormat = true;
  @field runTitle = contains(StringField);
  @field status = contains(StringField);
  @field nowWorkingOn = contains(StringField);
  @field upNext = contains(StringField);
  @field startedAt = contains(DatetimeField);
  @field entries = containsMany(RunLogEntry);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: RunLog) {
      return this.runTitle ? 'Run log — ' + this.runTitle : 'Run log';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked nowMs = Date.now();
    #ticker: ReturnType<typeof setInterval>;

    constructor(owner: unknown, args: any) {
      super(owner, args);
      this.#ticker = setInterval(() => {
        this.nowMs = Date.now();
      }, 1000);
      registerDestructor(this, () => clearInterval(this.#ticker));
    }

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
        : new Date(
            this.args.model.entries?.[this.args.model.entries.length - 1]
              ?.at ?? started,
          ).getTime();
      let secs = Math.max(0, Math.floor((end - new Date(started).getTime()) / 1000));
      let h = String(Math.floor(secs / 3600)).padStart(2, '0');
      let m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      let sec = String(secs % 60).padStart(2, '0');
      return h + ':' + m + ':' + sec;
    }
    get cardsReady() {
      return (this.args.model.entries ?? []).filter(
        (e) => e.kind === 'card-ready',
      ).length;
    }
    get designRounds() {
      return (this.args.model.entries ?? []).filter((e) => e.kind === 'design')
        .length;
    }
    get validationsGreen() {
      return (this.args.model.entries ?? []).filter(
        (e) => e.kind === 'validation' && !(e.headline ?? '').includes('failed'),
      ).length;
    }
    get issuesDone() {
      return (this.args.model.entries ?? []).filter(
        (e) => e.kind === 'issue-done',
      ).length;
    }
    get warmingUp() {
      return (
        this.running &&
        this.designRounds === 0 &&
        this.cardsReady === 0 &&
        (this.args.model.entries ?? []).length < 4
      );
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
            <div class='stat'>
              <div class='n accent'>{{this.cardsReady}}</div>
              <div class='l'>Cards ready</div>
            </div>
            <div class='stat'>
              <div class='n'>{{this.designRounds}}</div>
              <div class='l'>Design rounds</div>
            </div>
            <div class='stat'>
              <div class='n'>{{this.validationsGreen}}</div>
              <div class='l'>Validations green</div>
            </div>
            <div class='stat'>
              <div class='n'>{{this.issuesDone}}</div>
              <div class='l'>Issues done</div>
            </div>
          </aside>
          <div class='feed'>
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
            {{#each @fields.entries as |Entry|}}
              <Entry />
            {{/each}}
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
          flex-direction: column-reverse;
          /* pin content to the visual top; slack space stays below */
          justify-content: flex-end;
          padding: 6px 22px 22px 24px;
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
  };

  static embedded = class Embedded extends Component<typeof this> {
    get running() {
      return this.args.model.status === 'running';
    }
    get shipped() {
      return (this.args.model.entries ?? []).filter(
        (e) => e.kind === 'card-ready',
      ).length;
    }
    get rounds() {
      return (this.args.model.entries ?? []).filter((e) => e.kind === 'design')
        .length;
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
      return (this.args.model.entries ?? []).filter(
        (e) => e.kind === 'card-ready',
      ).length;
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
