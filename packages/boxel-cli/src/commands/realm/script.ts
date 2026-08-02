import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Command } from 'commander';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_RED, RESET } from '../../lib/colors.ts';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';

export interface NotebookInputReference {
  cellId?: string;
  executionId?: string;
  pointer?: string;
}

export interface RealmProgramActivity {
  sequence: number;
  timestamp: number;
  source: 'runtime' | 'script';
  status: 'running' | 'completed' | 'failed';
  phase: string;
  message: string;
  operation?: string;
  current?: number;
  total?: number;
}

export interface ExecuteRealmScriptOptions {
  mode?: 'preview' | 'commit';
  input?: unknown;
  notebook?: {
    sessionId: string;
    cellId: string;
    persistence?: 'ephemeral' | 'realm';
    ttlMs?: number;
    inputs?: Record<string, NotebookInputReference>;
    force?: boolean;
    runSaved?: boolean;
  };
  profileManager?: ProfileManager;
  realmSecretSeed?: string;
  authenticator?: RealmAuthenticator;
  onActivity?: (activity: RealmProgramActivity) => void | Promise<void>;
}

export type ExecuteRealmScriptResult =
  | { ok: true; output: unknown }
  | { ok: false; status?: number; error: string; output?: unknown };

interface RealmScriptCliOptions {
  realm: string;
  code?: string;
  file?: string;
  saved?: boolean;
  mode: 'preview' | 'commit';
  inputJson?: string;
  session?: string;
  cell?: string;
  persistence: 'ephemeral' | 'realm';
  ttlMs?: number;
  inputRef: string[];
  rerun?: boolean;
  activity: boolean;
  realmSecretSeed?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseInteger(value: string): number {
  let parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${value} is not an integer`);
  }
  return parsed;
}

export function parseNotebookInputRefs(
  specs: string[],
): Record<string, NotebookInputReference> {
  let result: Record<string, NotebookInputReference> = {};
  for (let spec of specs) {
    let equals = spec.indexOf('=');
    if (equals <= 0 || equals === spec.length - 1) {
      throw new Error(
        `Invalid --input-ref ${JSON.stringify(spec)}; expected name=cell:<cell-id>#/pointer or name=exec:<execution-id>#/pointer`,
      );
    }
    let name = spec.slice(0, equals);
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(name)) {
      throw new Error(`Invalid Realm Notebook input name ${name}`);
    }
    if (result[name]) {
      throw new Error(`Duplicate Realm Notebook input name ${name}`);
    }
    let sourceAndPointer = spec.slice(equals + 1);
    let hash = sourceAndPointer.indexOf('#');
    let source =
      hash === -1 ? sourceAndPointer : sourceAndPointer.slice(0, hash);
    let pointer =
      hash === -1 ? undefined : sourceAndPointer.slice(hash + 1) || '';
    if (pointer !== undefined && pointer !== '' && !pointer.startsWith('/')) {
      throw new Error(`Input pointer for ${name} must start with /`);
    }
    if (source.startsWith('cell:') && source.length > 5) {
      result[name] = {
        cellId: source.slice(5),
        ...(pointer === undefined ? {} : { pointer }),
      };
    } else if (
      source.startsWith('exec:') &&
      /^[a-f0-9]{64}$/.test(source.slice(5))
    ) {
      result[name] = {
        executionId: source.slice(5),
        ...(pointer === undefined ? {} : { pointer }),
      };
    } else {
      throw new Error(
        `Input source for ${name} must be cell:<cell-id> or exec:<64-character-execution-id>`,
      );
    }
  }
  return result;
}

export async function executeRealmScript(
  realmIdentifier: string,
  code: string | undefined,
  options: ExecuteRealmScriptOptions = {},
): Promise<ExecuteRealmScriptResult> {
  let resolvedRealm = resolveRealmIdentifier(realmIdentifier, {
    profileManager: options.profileManager,
  });
  if (!resolvedRealm.ok) return { ok: false, error: resolvedRealm.error };
  let realmUrl = resolvedRealm.url;
  let resolution = resolveRealmAuthenticator({
    realmUrl,
    profileManager: options.profileManager,
    realmSecretSeed: options.realmSecretSeed,
    authenticator: options.authenticator,
  });
  if (!resolution.ok) return { ok: false, error: resolution.error };

  let mode = options.mode ?? 'preview';
  let endpoint = new URL('_realm-program', realmUrl).href;
  let response;
  try {
    response = await resolution.authenticator.authedRealmFetch(endpoint, {
      method: mode === 'preview' ? 'QUERY' : 'POST',
      headers: {
        Accept: SupportedMimeType.JSON,
        'Content-Type': SupportedMimeType.JSON,
        ...(options.onActivity === undefined
          ? {}
          : { 'X-Boxel-Realm-Program-Stream': 'activity-v1' }),
      },
      body: JSON.stringify({
        ...(code === undefined ? {} : { code }),
        mode,
        ...(options.input === undefined ? {} : { input: options.input }),
        ...(options.notebook === undefined
          ? {}
          : { notebook: options.notebook }),
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (
    response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/x-ndjson')
  ) {
    if (!response.body) {
      return {
        ok: false,
        status: response.status,
        error: 'Realm Script activity stream has no response body',
      };
    }
    let decoder = new TextDecoder();
    let reader = response.body.getReader();
    let buffer = '';
    let terminal: ExecuteRealmScriptResult | undefined;
    let consumeLine = async (line: string) => {
      if (line.trim().length === 0) return;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error('Realm Script activity stream contained invalid JSON');
      }
      if (!event || typeof event !== 'object' || !('type' in event)) {
        throw new Error('Realm Script activity stream event is malformed');
      }
      if (event.type === 'activity' && 'activity' in event) {
        try {
          await options.onActivity?.(event.activity as RealmProgramActivity);
        } catch {
          // Rendering progress must not change the underlying Realm run.
        }
      } else if (event.type === 'result' && 'result' in event) {
        terminal = { ok: true, output: event.result };
      } else if (event.type === 'error' && 'error' in event) {
        let streamError = event.error;
        let message =
          streamError &&
          typeof streamError === 'object' &&
          'message' in streamError &&
          typeof streamError.message === 'string'
            ? streamError.message
            : 'Realm Script failed';
        terminal = {
          ok: false,
          error: message,
          output: { ok: false, error: streamError },
        };
      }
    };
    try {
      for (;;) {
        let { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          await consumeLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        if (done) break;
      }
      await consumeLine(buffer);
    } catch (error) {
      return {
        ok: false,
        status: response.status,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      reader.releaseLock();
    }
    return (
      terminal ?? {
        ok: false,
        status: response.status,
        error: 'Realm Script activity stream ended without a result',
      }
    );
  }

  let text = await response.text();
  let output: unknown;
  try {
    output = text.length === 0 ? null : JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: response.status,
      error: `Realm Script returned non-JSON output (HTTP ${response.status})`,
    };
  }
  if (!response.ok) {
    let message =
      output &&
      typeof output === 'object' &&
      'error' in output &&
      output.error &&
      typeof output.error === 'object' &&
      'message' in output.error &&
      typeof output.error.message === 'string'
        ? output.error.message
        : `Realm Script failed (HTTP ${response.status})`;
    return { ok: false, status: response.status, error: message, output };
  }
  return { ok: true, output };
}

export function registerRealmScriptCommand(realm: Command): void {
  realm
    .command('script')
    .description(
      'Run an ad-hoc Realm Script or a resumable Realm Notebook cell',
    )
    .requiredOption('--realm <realm-url>', 'Realm URL or identifier')
    .option('--code <javascript>', 'Inline Realm Script source')
    .option('--file <path>', 'Read Realm Script source from a local file')
    .option('--saved', 'Run the source saved for this notebook cell')
    .option('--mode <mode>', 'preview or commit', 'preview')
    .option('--input-json <json>', 'JSON value exposed as realm.input')
    .option('--session <id>', 'Realm Notebook session or Matrix room id')
    .option('--cell <id>', 'Realm Notebook cell id')
    .option(
      '--persistence <kind>',
      'ephemeral (TTL session) or realm (encrypted durable files)',
      'ephemeral',
    )
    .option('--ttl-ms <milliseconds>', 'Ephemeral session TTL', parseInteger)
    .option(
      '--input-ref <binding>',
      'Cell input: name=cell:<cell-id>#/result/value/path or name=exec:<execution-id>#/result/value/path',
      collect,
      [],
    )
    .option('--rerun', 'Run a new revision instead of reusing a completed cell')
    .option('--no-activity', 'Disable live Realm Script activity on stderr')
    .option(
      '--realm-secret-seed',
      'Use administrative seed auth (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(async (opts: RealmScriptCliOptions) => {
      try {
        let sourceChoices = [
          opts.code,
          opts.file,
          opts.saved ? true : undefined,
        ].filter((value) => value !== undefined).length;
        if (sourceChoices !== 1) {
          throw new Error('Pass exactly one of --code, --file, or --saved');
        }
        if ((opts.session === undefined) !== (opts.cell === undefined)) {
          throw new Error('--session and --cell must be provided together');
        }
        if (opts.saved && opts.session === undefined) {
          throw new Error('--saved requires --session and --cell');
        }
        if (opts.mode !== 'preview' && opts.mode !== 'commit') {
          throw new Error('--mode must be preview or commit');
        }
        if (opts.persistence !== 'ephemeral' && opts.persistence !== 'realm') {
          throw new Error('--persistence must be ephemeral or realm');
        }
        let code =
          opts.code ??
          (opts.file === undefined
            ? undefined
            : await readFile(resolve(opts.file), 'utf8'));
        let input =
          opts.inputJson === undefined ? undefined : JSON.parse(opts.inputJson);
        let inputRefs = parseNotebookInputRefs(opts.inputRef);
        let notebook =
          opts.session === undefined
            ? undefined
            : {
                sessionId: opts.session,
                cellId: opts.cell!,
                persistence: opts.persistence,
                ...(opts.ttlMs === undefined ? {} : { ttlMs: opts.ttlMs }),
                ...(opts.inputRef.length === 0 ? {} : { inputs: inputRefs }),
                force: opts.rerun === true,
                runSaved: opts.saved === true,
              };
        let realmSecretSeed = await resolveRealmSecretSeed(
          opts.realmSecretSeed === true,
        );
        let result = await executeRealmScript(opts.realm, code, {
          mode: opts.mode,
          input,
          notebook,
          realmSecretSeed,
          ...(opts.activity === false
            ? {}
            : {
                onActivity(activity) {
                  let progress =
                    activity.current === undefined
                      ? ''
                      : activity.total === undefined
                        ? ` (${activity.current})`
                        : ` (${activity.current}/${activity.total})`;
                  cliLog.info(`[realm] ${activity.message}${progress}`);
                },
              }),
        });
        cliLog.output(JSON.stringify(result, null, 2));
        if (!result.ok) {
          console.error(`${FG_RED}Error:${RESET} ${result.error}`);
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(
          `${FG_RED}Error:${RESET} ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
      }
    });
}
