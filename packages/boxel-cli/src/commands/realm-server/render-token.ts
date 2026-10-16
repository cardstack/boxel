import type { Command } from 'commander';
import { closeSync, constants, fchmodSync, openSync, writeSync } from 'fs';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_GREEN, RESET } from '../../lib/colors.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { operatorRequest } from '../../lib/seed-auth.ts';

// `boxel realm-server render-token`: a diagnostic session for rendering one
// live card in a browser as the indexer renders it. The realm server issues
// it, on an operator token signed with the realm secret seed, which never
// leaves this machine. The session reads as the realm owner and does nothing
// else: it is read-only, lives for minutes, and covers the card's realm and,
// unless `--realm-only` is given, every realm the owner may read, which is
// what the indexer's render carries. The server logs the mint and each use on
// its `diagnostic-render` channel with the operator note.
//
// The command writes the render URL and the `boxel-session` value the render
// tab reads to a file only this user can read, so that whoever drives the
// browser (an operator, or Claude through Chrome) picks them up from there
// and never handles the seed.

export const DEFAULT_RENDER_TOKEN_OUTPUT = '/tmp/boxel-diagnostic-render.json';

export const RENDER_FORMATS = ['isolated', 'embedded', 'fitted', 'atom'];

export interface DiagnosticRenderSession {
  id: string;
  card: string;
  realm: string;
  user: string;
  realms: string[];
  hostURL: string;
  mintedAt: string;
  expiresAt: string;
  // The `boxel-session` value: a JSON map from realm to session.
  session: string;
}

export interface DiagnosticRender extends DiagnosticRenderSession {
  renderURL: string;
}

export interface RenderTokenOptions {
  realmServerUrl: string;
  realmSecretSeed: string;
  fetch?: typeof globalThis.fetch;
}

export interface RenderTokenRequest {
  card: string;
  note: string;
  realmOnly?: boolean;
  format?: string;
  clearCache?: boolean;
}

// The URL of the render route the prerenderer visits for a card: the card's
// `.json` file, a nonce, the route options, and the format, at recursion depth
// zero.
export function buildRenderURL(
  hostURL: string,
  card: string,
  { format = 'isolated', clearCache = false } = {},
): string {
  let cardFile = card.endsWith('.json') ? card : `${card}.json`;
  let options = { cardRender: true, ...(clearCache ? { clearCache } : {}) };
  let host = hostURL.endsWith('/') ? hostURL : `${hostURL}/`;
  return `${host}render/${encodeURIComponent(cardFile)}/1/${encodeURIComponent(JSON.stringify(options))}/html/${format}/0`;
}

export async function mintRenderToken(
  options: RenderTokenOptions,
  request: RenderTokenRequest,
): Promise<DiagnosticRender> {
  let format = request.format ?? 'isolated';
  if (!RENDER_FORMATS.includes(format)) {
    throw new Error(`--format must be one of ${RENDER_FORMATS.join(', ')}`);
  }
  if (!request.note.trim()) {
    throw new Error('The operator note is empty');
  }
  let { url, response } = await operatorRequest(
    options,
    'diagnostic-render',
    '_diagnostic-render-token',
    'POST',
    {
      card: request.card,
      note: request.note,
      ...(request.realmOnly ? { realmOnly: true } : {}),
    },
  );
  if (!response.ok) {
    let text = await response.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      let errors = JSON.parse(text)?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        message = errors.join('; ');
      }
    } catch {
      // Not JSON; report the text as it is.
    }
    throw new Error(`POST ${url} answered HTTP ${response.status}: ${message}`);
  }
  let minted = (await response.json()) as DiagnosticRenderSession;
  return {
    ...minted,
    renderURL: buildRenderURL(minted.hostURL, minted.card, {
      format,
      clearCache: request.clearCache,
    }),
  };
}

// Writes the file readable by this user alone. The default path is in a
// shared /tmp under a predictable name, so the open refuses a symlink there
// (`O_NOFOLLOW`) rather than write the session wherever it points, and a file
// someone else created there fails the `fchmodSync`, which only the owner may
// do. A file this creates is 0600 from the start; one it reuses is narrowed
// to 0600 before anything is written.
export function writeRenderFile(path: string, render: DiagnosticRender): void {
  let fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `${JSON.stringify(render, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
}

interface RenderTokenCliOptions {
  note?: string;
  realmServer?: string;
  realmOnly?: boolean;
  format?: string;
  clearCache?: boolean;
  output?: string | false;
  json?: boolean;
}

export function registerRenderTokenCommand(realmServer: Command): void {
  realmServer
    .command('render-token')
    .description(
      "Issue a read-only diagnostic session for rendering a live card in a browser as the indexer does, and write it with the card's render URL to a file",
    )
    .argument('<card-url>', 'The card to render')
    .requiredOption(
      '--note <text>',
      'Who is asking and why. The server logs it with the mint and every use of the session. A name in it is recorded as given, not verified',
    )
    .option(
      '--realm-server <url>',
      "The realm server that holds the card (default: the card URL's origin)",
    )
    .option(
      '--realm-only',
      "Cover only the card's own realm, not every realm its owner may read",
    )
    .option(
      '--format <format>',
      `The render format: ${RENDER_FORMATS.join(', ')}`,
      'isolated',
    )
    .option(
      '--clear-cache',
      'Have the render drop its loader cache before it starts',
    )
    .option(
      '--output <path>',
      'Where to write the render URL and session',
      DEFAULT_RENDER_TOKEN_OUTPUT,
    )
    .option('--no-output', 'Write no file')
    .option(
      '--json',
      'Print everything the file holds, the session included, as JSON',
    )
    .action(async (card: string, options: RenderTokenCliOptions) => {
      try {
        let realmSecretSeed = await resolveRealmSecretSeed(true);
        if (!realmSecretSeed) {
          throw new Error('A realm secret seed is required');
        }
        let render = await mintRenderToken(
          {
            realmServerUrl: options.realmServer ?? new URL(card).origin,
            realmSecretSeed,
          },
          {
            card,
            note: options.note!,
            realmOnly: options.realmOnly,
            format: options.format,
            clearCache: options.clearCache,
          },
        );
        if (options.output) {
          writeRenderFile(options.output, render);
        }
        if (options.json) {
          cliLog.output(JSON.stringify(render, null, 2));
          return;
        }
        console.log(
          `${FG_GREEN}Issued diagnostic session ${render.id}.${RESET}`,
        );
        console.log(`  reads as: ${render.user}`);
        console.log(`  realms: ${render.realms.join(', ')}`);
        console.log(`  expires: ${render.expiresAt}`);
        console.log(`  render URL: ${render.renderURL}`);
        if (options.output) {
          console.log(`  written to: ${options.output}`);
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
