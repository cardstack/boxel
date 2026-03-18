import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs as parseNodeArgs } from 'node:util';

import {
  loadFactoryBrief,
  type FactoryBrief,
  type FactoryBriefFetch,
} from './factory-brief';
import { createBoxelRealmFetch } from './realm-auth';

const allowedModes = ['bootstrap', 'implement', 'resume'] as const;

export type FactoryEntrypointMode = (typeof allowedModes)[number];

export interface FactoryEntrypointOptions {
  briefUrl: string;
  authToken: string | null;
  targetRealmPath: string;
  targetRealmUrl: string | null;
  mode: FactoryEntrypointMode;
}

export interface FactoryEntrypointAction {
  name: string;
  status: 'ok';
  detail: string;
}

export interface FactoryEntrypointBriefSummary extends FactoryBrief {
  url: string;
}

export interface FactoryEntrypointSummary {
  command: 'factory:go';
  mode: FactoryEntrypointMode;
  brief: FactoryEntrypointBriefSummary;
  targetRealm: {
    path: string;
    url: string | null;
    exists: boolean;
  };
  actions: FactoryEntrypointAction[];
  result: {
    status: 'ready';
    nextStep: string;
  };
}

export interface RunFactoryEntrypointDependencies {
  fetch?: FactoryBriefFetch;
  createBriefFetch?: (
    briefUrl: string,
    authToken: string | null,
    fetch?: FactoryBriefFetch,
  ) => FactoryBriefFetch;
}

export class FactoryEntrypointUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactoryEntrypointUsageError';
  }
}

export function getFactoryEntrypointUsage(): string {
  return [
    'Usage:',
    '  pnpm factory:go -- --brief-url <url> --target-realm-path <path> [options]',
    '',
    'Required:',
    '  --brief-url <url>           Absolute URL for the source brief card',
    '  --target-realm-path <path>  Local filesystem path to the target realm',
    '',
    'Options:',
    '  --auth-token <token>        Optional Authorization header override for fetching the brief',
    '  --target-realm-url <url>    Absolute URL for the target realm when known',
    '  --mode <mode>               One of: bootstrap, implement, resume',
    '  --help                      Show this usage information',
  ].join('\n');
}

export function parseFactoryEntrypointArgs(
  argv: string[],
): FactoryEntrypointOptions {
  let normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  let parsed;

  try {
    parsed = parseNodeArgs({
      args: normalizedArgv,
      allowPositionals: true,
      strict: true,
      options: {
        'brief-url': {
          type: 'string',
        },
        'auth-token': {
          type: 'string',
        },
        'target-realm-path': {
          type: 'string',
        },
        'target-realm-url': {
          type: 'string',
        },
        help: {
          type: 'boolean',
        },
        mode: {
          type: 'string',
        },
      },
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    throw new FactoryEntrypointUsageError(message);
  }

  if (parsed.positionals.length > 0) {
    throw new FactoryEntrypointUsageError(
      `Unexpected positional arguments: ${parsed.positionals.join(', ')}`,
    );
  }

  let briefUrl = requireStringValue(parsed.values['brief-url'], '--brief-url');
  let authToken = optionalStringValue(parsed.values['auth-token']);
  let targetRealmPath = requireStringValue(
    parsed.values['target-realm-path'],
    '--target-realm-path',
  );
  let targetRealmUrl = optionalStringValue(parsed.values['target-realm-url']);
  let mode = parseMode(parsed.values.mode);

  return {
    briefUrl: normalizeUrl(briefUrl, '--brief-url'),
    authToken: authToken ?? null,
    targetRealmPath,
    targetRealmUrl: targetRealmUrl
      ? normalizeUrl(targetRealmUrl, '--target-realm-url')
      : null,
    mode,
  };
}

export function wantsFactoryEntrypointHelp(argv: string[]): boolean {
  let normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  return normalizedArgv.includes('--help');
}

export async function runFactoryEntrypoint(
  options: FactoryEntrypointOptions,
  dependencies?: RunFactoryEntrypointDependencies,
): Promise<FactoryEntrypointSummary> {
  let fetchImpl = (dependencies?.createBriefFetch ?? createFactoryBriefFetch)(
    options.briefUrl,
    options.authToken,
    dependencies?.fetch,
  );

  let brief = await loadFactoryBrief(options.briefUrl, {
    fetch: fetchImpl,
  });

  return buildFactoryEntrypointSummary(options, brief);
}

function createFactoryBriefFetch(
  briefUrl: string,
  authToken: string | null,
  fetch?: FactoryBriefFetch,
): FactoryBriefFetch {
  return createBoxelRealmFetch(briefUrl, {
    authorization: authToken ?? undefined,
    fetch,
  });
}

export function buildFactoryEntrypointSummary(
  options: FactoryEntrypointOptions,
  brief: FactoryBrief,
): FactoryEntrypointSummary {
  let resolvedTargetRealmPath = resolve(process.cwd(), options.targetRealmPath);
  let targetRealmExists = existsSync(resolvedTargetRealmPath);
  let actions: FactoryEntrypointAction[] = [
    {
      name: 'validated-inputs',
      status: 'ok',
      detail: 'accepted required CLI inputs',
    },
    {
      name: 'fetched-brief',
      status: 'ok',
      detail: brief.sourceUrl,
    },
    {
      name: 'normalized-brief',
      status: 'ok',
      detail: 'prepared-ai-judgment-prompt',
    },
    {
      name: 'resolved-target-realm-path',
      status: 'ok',
      detail: resolvedTargetRealmPath,
    },
  ];

  if (options.targetRealmUrl) {
    actions.push({
      name: 'resolved-target-realm-url',
      status: 'ok',
      detail: options.targetRealmUrl,
    });
  }

  return {
    command: 'factory:go',
    mode: options.mode,
    brief: {
      ...brief,
      url: brief.sourceUrl,
    },
    targetRealm: {
      path: resolvedTargetRealmPath,
      url: options.targetRealmUrl,
      exists: targetRealmExists,
    },
    actions,
    result: {
      status: 'ready',
      nextStep:
        options.mode === 'bootstrap'
          ? 'bootstrap-target-realm'
          : 'bootstrap-and-select-active-ticket',
    },
  };
}

function requireStringValue(
  value: string | boolean | undefined,
  flagName: string,
): string {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }

  throw new FactoryEntrypointUsageError(`Missing required ${flagName}`);
}

function optionalStringValue(
  value: string | boolean | undefined,
): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }

  return undefined;
}

function parseMode(value: string | boolean | undefined): FactoryEntrypointMode {
  if (value === undefined) {
    return 'implement';
  }

  if (typeof value !== 'string') {
    throw new FactoryEntrypointUsageError(
      'Expected --mode to be a string value',
    );
  }

  if (isFactoryEntrypointMode(value)) {
    return value;
  }

  throw new FactoryEntrypointUsageError(
    `Invalid --mode "${value}". Expected one of: ${allowedModes.join(', ')}`,
  );
}

function isFactoryEntrypointMode(
  value: string,
): value is FactoryEntrypointMode {
  return (allowedModes as readonly string[]).includes(value);
}

function normalizeUrl(rawUrl: string, flagName: string): string {
  try {
    return new URL(rawUrl).href;
  } catch (_error) {
    throw new FactoryEntrypointUsageError(
      `Expected ${flagName} to be an absolute URL, received: ${rawUrl}`,
    );
  }
}
