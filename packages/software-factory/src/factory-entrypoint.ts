import { parseArgs as parseNodeArgs } from 'node:util';

import {
  bootstrapProjectArtifacts,
  type FactoryBootstrapOptions,
  type FactoryBootstrapResult,
} from './factory-bootstrap';
import { loadFactoryBrief, type FactoryBrief } from './factory-brief';
import { FactoryEntrypointUsageError } from './factory-entrypoint-errors';
import {
  runFactoryImplement,
  type ImplementConfig,
  type ImplementResult,
} from '../scripts/lib/factory-implement';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
  type FactoryTargetRealmBootstrapResult,
  type FactoryTargetRealmResolution,
  type ResolveFactoryTargetRealmOptions,
} from './factory-target-realm';
import { createBoxelRealmFetch } from './realm-auth';

const allowedModes = ['bootstrap', 'implement', 'resume'] as const;

export type FactoryEntrypointMode = (typeof allowedModes)[number];

export interface FactoryEntrypointOptions {
  briefUrl: string;
  targetRealmUrl: string | null;
  realmServerUrl: string | null;
  mode: FactoryEntrypointMode;
  model?: string;
}

export interface FactoryEntrypointAction {
  name: string;
  status: 'ok';
  detail: string;
}

export interface FactoryEntrypointBriefSummary extends FactoryBrief {
  url: string;
}

export interface FactoryEntrypointBootstrapSummary {
  projectId: string;
  knowledgeArticleIds: string[];
  ticketIds: string[];
  activeTicket: {
    id: string;
    status: string;
  };
}

export interface FactoryEntrypointImplementSummary {
  outcome: ImplementResult['outcome'];
  iterations: number;
  ticketId: string;
  testRealmUrl: string;
  message?: string;
  toolCallCount: number;
}

export interface FactoryEntrypointSummary {
  command: 'factory:go';
  mode: FactoryEntrypointMode;
  brief: FactoryEntrypointBriefSummary;
  targetRealm: {
    url: string;
    ownerUsername: string;
  };
  bootstrap: FactoryEntrypointBootstrapSummary;
  actions: FactoryEntrypointAction[];
  implement?: FactoryEntrypointImplementSummary;
  result: {
    status: 'ready' | 'completed' | 'failed';
    nextStep: string;
  };
}

export interface RunFactoryEntrypointDependencies {
  fetch?: typeof globalThis.fetch;
  resolveTargetRealm?: (
    options: ResolveFactoryTargetRealmOptions,
  ) => FactoryTargetRealmResolution;
  bootstrapTargetRealm?: (
    resolution: FactoryTargetRealmResolution,
  ) => Promise<FactoryTargetRealmBootstrapResult>;
  bootstrapArtifacts?: (
    brief: FactoryBrief,
    targetRealmUrl: string,
    options?: FactoryBootstrapOptions,
  ) => Promise<FactoryBootstrapResult>;
  implement?: (config: ImplementConfig) => Promise<ImplementResult>;
}
export { FactoryEntrypointUsageError } from './factory-entrypoint-errors';

export function getFactoryEntrypointUsage(): string {
  return [
    'Usage:',
    '  pnpm factory:go -- --brief-url <url> --target-realm-url <url> [options]',
    '',
    'Required:',
    '  --brief-url <url>           Absolute URL for the source brief card',
    '  --target-realm-url <url>    Absolute URL for the target realm',
    '',
    'Options:',
    '  --realm-server-url <url>   Explicit realm server URL for target realm bootstrap',
    '  --mode <mode>               One of: bootstrap, implement, resume',
    '  --model <model>             OpenRouter model ID (e.g., anthropic/claude-sonnet-4)',
    '  --help                      Show this usage information',
    '',
    'Auth:',
    '  MATRIX_USERNAME is required and determines the target realm owner.',
    '  For public briefs, no auth setup is needed.',
    '  For private briefs, factory:go can authenticate via:',
    '    1. the active Boxel profile, or',
    '    2. MATRIX_URL + MATRIX_USERNAME + MATRIX_PASSWORD + REALM_SERVER_URL',
    '  Target realm creation uses separate realm-server auth and post-create realm auth.',
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
        'target-realm-url': {
          type: 'string',
        },
        'realm-server-url': {
          type: 'string',
        },
        help: {
          type: 'boolean',
        },
        mode: {
          type: 'string',
        },
        model: {
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
  let targetRealmUrl = requireStringValue(
    parsed.values['target-realm-url'],
    '--target-realm-url',
  );
  let realmServerUrl =
    typeof parsed.values['realm-server-url'] === 'string'
      ? normalizeUrl(parsed.values['realm-server-url'], '--realm-server-url')
      : null;
  let mode = parseMode(parsed.values.mode);
  let model =
    typeof parsed.values.model === 'string'
      ? parsed.values.model.trim() || undefined
      : undefined;

  return {
    briefUrl: normalizeUrl(briefUrl, '--brief-url'),
    targetRealmUrl: normalizeUrl(targetRealmUrl, '--target-realm-url'),
    realmServerUrl,
    mode,
    model,
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
  let targetRealmResolution = (
    dependencies?.resolveTargetRealm ?? resolveFactoryTargetRealm
  )({
    targetRealmUrl: options.targetRealmUrl,
    realmServerUrl: options.realmServerUrl,
  });
  let fetchImpl = createBoxelRealmFetch(options.briefUrl, {
    fetch: dependencies?.fetch,
  });

  let brief = await loadFactoryBrief(options.briefUrl, {
    fetch: fetchImpl,
  });

  let targetRealm = await (
    dependencies?.bootstrapTargetRealm ?? bootstrapFactoryTargetRealm
  )(targetRealmResolution);

  let realmFetch = createBoxelRealmFetch(targetRealm.url, {
    authorization: targetRealm.authorization,
    fetch: dependencies?.fetch,
    primeRealmURL: targetRealm.url,
  });

  let artifacts = await (
    dependencies?.bootstrapArtifacts ?? bootstrapProjectArtifacts
  )(brief, targetRealm.url, {
    fetch: realmFetch,
    darkfactoryModuleUrl: new URL(
      'software-factory/darkfactory',
      targetRealm.serverUrl,
    ).href,
  });

  let summary = buildFactoryEntrypointSummary(
    options,
    brief,
    targetRealm,
    artifacts,
  );

  // Run implement mode if requested
  if (options.mode === 'implement') {
    let implementFn = dependencies?.implement ?? runFactoryImplement;
    let implementResult = await implementFn({
      briefUrl: options.briefUrl,
      targetRealmUrl: targetRealm.url,
      realmServerUrl: targetRealm.serverUrl,
      ownerUsername: targetRealm.ownerUsername,
      authorization: targetRealm.authorization,
      bootstrapResult: artifacts,
      model: options.model,
      fetch: dependencies?.fetch,
    });

    summary.implement = {
      outcome: implementResult.outcome,
      iterations: implementResult.iterations,
      ticketId: implementResult.ticketId,
      testRealmUrl: implementResult.testRealmUrl,
      message: implementResult.message,
      toolCallCount: implementResult.toolCallLog.length,
    };

    let succeeded =
      implementResult.outcome === 'tests_passed' ||
      implementResult.outcome === 'done';
    summary.result = {
      status: succeeded ? 'completed' : 'failed',
      nextStep: succeeded
        ? 'advance-to-next-ticket'
        : `implement-${implementResult.outcome}`,
    };
  }

  return summary;
}
export function buildFactoryEntrypointSummary(
  options: FactoryEntrypointOptions,
  brief: FactoryBrief,
  targetRealm: FactoryTargetRealmBootstrapResult,
  artifacts: FactoryBootstrapResult,
): FactoryEntrypointSummary {
  let actions: FactoryEntrypointAction[] = [
    {
      name: 'validated-inputs',
      status: 'ok',
      detail: 'accepted required CLI inputs',
    },
    {
      name: 'resolved-target-realm-owner',
      status: 'ok',
      detail: targetRealm.ownerUsername,
    },
    {
      name: 'fetched-brief',
      status: 'ok',
      detail: brief.sourceUrl,
    },
    {
      name: 'normalized-brief',
      status: 'ok',
      detail: 'prepared-brief-data',
    },
    {
      name: 'resolved-target-realm',
      status: 'ok',
      detail: targetRealm.url,
    },
    {
      name: 'bootstrapped-target-realm',
      status: 'ok',
      detail: targetRealm.createdRealm
        ? 'created realm via realm server API'
        : 'target realm already existed',
    },
    {
      name: 'bootstrapped-project-artifacts',
      status: 'ok',
      detail: `project=${artifacts.project.status} tickets=${artifacts.tickets.map((t) => t.status).join(',')}`,
    },
  ];

  return {
    command: 'factory:go',
    mode: options.mode,
    brief: {
      ...brief,
      url: brief.sourceUrl,
    },
    targetRealm: {
      url: targetRealm.url,
      ownerUsername: targetRealm.ownerUsername,
    },
    bootstrap: {
      projectId: artifacts.project.id,
      knowledgeArticleIds: artifacts.knowledgeArticles.map((ka) => ka.id),
      ticketIds: artifacts.tickets.map((t) => t.id),
      activeTicket: {
        id: artifacts.activeTicket.id,
        status: artifacts.activeTicket.status,
      },
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
