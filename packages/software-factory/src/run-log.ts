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
    | 'note';
  headline: string;
  body?: string;
  /** Absolute URL of a screenshot image to embed. */
  imageUrl?: string;
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

const RUN_LOG_GTS = `import {
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

class RunLogEntry extends FieldDef {
  static displayName = 'Run Log Entry';
  @field kind = contains(StringField);
  @field at = contains(DatetimeField);
  @field headline = contains(StringField);
  @field body = contains(MarkdownField);
  @field imageUrl = contains(StringField);
  @field card = linksTo(() => CardDef);

  static embedded = class Embedded extends Component<typeof this> {
    get timeLabel() {
      let at = this.args.model.at;
      if (!at) return '';
      try {
        return new Date(at).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return '';
      }
    }
    <template>
      <div class='entry' data-kind={{@model.kind}}>
        <div class='rail'>
          <span class='time'>{{this.timeLabel}}</span>
          <span class='kind'>{{@model.kind}}</span>
        </div>
        <div class='content'>
          <h3 class='headline'>{{@model.headline}}</h3>
          {{#if @model.body}}
            <div class='body'><@fields.body /></div>
          {{/if}}
          {{#if @model.imageUrl}}
            <img class='shot' src={{@model.imageUrl}} alt={{@model.headline}} />
          {{/if}}
          {{#if @model.card}}
            <div class='live-card'>
              <@fields.card @format='embedded' />
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .entry {
          display: flex;
          gap: 14px;
          padding: 14px 0;
          border-bottom: 1px solid var(--boxel-border-color, #e7e7e3);
        }
        .rail {
          flex: none;
          width: 82px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .time {
          font: 500 11px/1 var(--boxel-monospace-font-family, monospace);
          font-variant-numeric: tabular-nums;
          color: #6f6f6a;
        }
        .kind {
          font: 500 9px/1.5 var(--boxel-monospace-font-family, monospace);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #a3a39d;
        }
        .entry[data-kind='card-ready'] .kind,
        .entry[data-kind='run-done'] .kind {
          color: #15803d;
        }
        .content {
          flex: 1;
          min-width: 0;
        }
        .headline {
          margin: 0;
          font: 600 14px/1.35 var(--boxel-font-family, sans-serif);
        }
        .body {
          margin-top: 4px;
          font: 400 12.5px/1.5 var(--boxel-font-family, sans-serif);
          color: #6f6f6a;
        }
        .shot {
          display: block;
          margin-top: 10px;
          max-width: 100%;
          border: 1px solid var(--boxel-border-color, #e7e7e3);
          border-radius: 6px;
        }
        .live-card {
          margin-top: 10px;
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
      return this.runTitle ? \`Run log — \${this.runTitle}\` : 'Run log';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='run-log'>
        <header class='masthead'>
          <div class='title-row'>
            <h1>{{@model.runTitle}}</h1>
            <span class='status' data-status={{@model.status}}>
              {{#if (eqStatus @model.status 'running')}}● live{{else}}{{@model.status}}{{/if}}
            </span>
          </div>
          <div class='now-next'>
            <div><span class='label'>Now</span> {{@model.nowWorkingOn}}</div>
            <div><span class='label'>Next</span> {{if @model.upNext @model.upNext '—'}}</div>
          </div>
        </header>
        <div class='feed'>
          {{#each @fields.entries as |Entry|}}
            <Entry />
          {{/each}}
        </div>
      </article>
      <style scoped>
        .run-log {
          max-width: 760px;
          margin: 0 auto;
          padding: 28px 24px 60px;
          background: var(--boxel-background, #fafaf9);
          font-family: var(--boxel-font-family, sans-serif);
        }
        .masthead {
          border-bottom: 2px solid #1c1c1a;
          padding-bottom: 14px;
          margin-bottom: 4px;
        }
        .title-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        h1 {
          margin: 0;
          font: 650 24px/1.2 var(--boxel-font-family, sans-serif);
          letter-spacing: -0.01em;
        }
        .status {
          font: 600 11px/1 var(--boxel-monospace-font-family, monospace);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #6f6f6a;
        }
        .status[data-status='running'] {
          color: #be185d;
        }
        .now-next {
          display: flex;
          gap: 28px;
          margin-top: 10px;
          font: 500 13px/1.4 var(--boxel-font-family, sans-serif);
        }
        .label {
          font: 500 9.5px/1 var(--boxel-monospace-font-family, monospace);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #a3a39d;
          margin-right: 6px;
        }
        .feed {
          display: flex;
          flex-direction: column-reverse;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='row'>
        <span class='status' data-status={{@model.status}}>
          {{#if (eqStatus @model.status 'running')}}● LIVE{{else}}{{@model.status}}{{/if}}
        </span>
        <div class='mid'>
          <div class='name'>{{@model.runTitle}}</div>
          <div class='meta'>Now: {{@model.nowWorkingOn}}</div>
        </div>
      </div>
      <style scoped>
        .row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          font-family: var(--boxel-font-family, sans-serif);
        }
        .status {
          font: 600 10px/1 var(--boxel-monospace-font-family, monospace);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #6f6f6a;
          flex: none;
        }
        .status[data-status='running'] {
          color: #be185d;
        }
        .mid { flex: 1; min-width: 0; }
        .name { font: 500 13.5px/1.3 var(--boxel-font-family, sans-serif); }
        .meta {
          font: 400 11.5px/1.4 var(--boxel-font-family, sans-serif);
          color: #6f6f6a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <span class='status' data-status={{@model.status}}>
          {{#if (eqStatus @model.status 'running')}}●{{else}}✓{{/if}}
        </span>
        <span class='name'>{{@model.runTitle}}</span>
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          height: 100%;
          overflow: hidden;
          font-family: var(--boxel-font-family, sans-serif);
        }
        .status { color: #be185d; flex: none; font-size: 10px; }
        .status[data-status='completed'] { color: #15803d; }
        .name {
          font: 500 12px/1.3 var(--boxel-font-family, sans-serif);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}

function eqStatus(a: string | undefined, b: string) {
  return a === b;
}
`;
