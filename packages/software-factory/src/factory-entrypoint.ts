import { parseArgs as parseNodeArgs } from 'node:util';

import { inferDarkfactoryModuleUrl } from './factory-seed';
import { loadFactoryBrief, type FactoryBrief } from './factory-brief';
import { FactoryEntrypointUsageError } from './factory-entrypoint-errors';
import {
  runFactoryIssueLoop,
  type IssueLoopWiringConfig,
} from './factory-issue-loop-wiring';
import { createSeedIssue, type SeedIssueResult } from './factory-seed';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
  type FactoryTargetRealmBootstrapResult,
  type FactoryTargetRealmResolution,
  type ResolveFactoryTargetRealmOptions,
} from './factory-target-realm';
import type { IssueLoopResult } from './issue-loop';
import { createBoxelRealmFetch } from './realm-auth';

export interface FactoryEntrypointOptions {
  briefUrl: string;
  targetRealmUrl: string | null;
  realmServerUrl: string | null;
  model?: string;
  debug?: boolean;
  retryBlocked?: boolean;
}

export interface FactoryEntrypointAction {
  name: string;
  status: 'ok';
  detail: string;
}

export interface FactoryEntrypointBriefSummary extends FactoryBrief {
  url: string;
}

export interface FactoryEntrypointSeedSummary {
  seedIssueId: string;
  seedIssueStatus: SeedIssueResult['status'];
}

export interface FactoryEntrypointIssueLoopSummary {
  outcome: IssueLoopResult['outcome'];
  outerCycles: number;
  issueResults: {
    issueId: string;
    exitReason: string;
    innerIterations: number;
    toolCallCount: number;
  }[];
}

export interface FactoryEntrypointSummary {
  command: 'factory:go';
  brief: FactoryEntrypointBriefSummary;
  targetRealm: {
    url: string;
    ownerUsername: string;
  };
  seedIssue: FactoryEntrypointSeedSummary;
  actions: FactoryEntrypointAction[];
  issueLoop?: FactoryEntrypointIssueLoopSummary;
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
  createSeed?: (
    brief: FactoryBrief,
    targetRealmUrl: string,
    options: { fetch?: typeof globalThis.fetch; darkfactoryModuleUrl: string },
  ) => Promise<SeedIssueResult>;
  runIssueLoop?: (config: IssueLoopWiringConfig) => Promise<IssueLoopResult>;
}
export { FactoryEntrypointUsageError } from './factory-entrypoint-errors';

export function getFactoryEntrypointUsage(): string {
  return [
    'Usage:',
    '  pnpm factory:go --brief-url <url> --target-realm-url <url> [options]',
    '',
    'Required:',
    '  --brief-url <url>           Absolute URL for the source brief card',
    '  --target-realm-url <url>    Absolute URL for the target realm',
    '',
    'Options:',
    '  --realm-server-url <url>   Realm server URL (default: http://localhost:4201/)',
    '  --no-retry-blocked          Skip retrying blocked issues (by default, blocked issues are reset to backlog)',
    '  --model <model>             OpenRouter model ID (e.g., anthropic/claude-sonnet-4)',
    '  --debug                     Log LLM prompts and responses to stderr',
    '  --help                      Show this usage information',
    '',
    'Auth:',
    '  MATRIX_USERNAME is required and determines the target realm owner.',
    '  For public briefs, no auth setup is needed.',
    '  For private briefs, factory:go can authenticate via:',
    '    1. the active Boxel profile, or',
    '    2. MATRIX_URL + MATRIX_USERNAME + MATRIX_PASSWORD environment variables',
    '  The realm server URL comes from --realm-server-url (default: http://localhost:4201/).',
    '  It is never inferred from --target-realm-url or read from an environment variable.',
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
        'no-retry-blocked': {
          type: 'boolean',
        },
        model: {
          type: 'string',
        },
        debug: {
          type: 'boolean',
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
  let model =
    typeof parsed.values.model === 'string'
      ? parsed.values.model.trim() || undefined
      : undefined;

  return {
    briefUrl: normalizeUrl(briefUrl, '--brief-url'),
    targetRealmUrl: normalizeUrl(targetRealmUrl, '--target-realm-url'),
    realmServerUrl,
    model,
    debug: parsed.values.debug === true ? true : undefined,
    retryBlocked: parsed.values['no-retry-blocked'] === true ? false : true,
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

  let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealm.url);

  // Create the seed issue in the realm
  let seedResult = await (dependencies?.createSeed ?? createSeedIssue)(
    brief,
    targetRealm.url,
    { fetch: realmFetch, darkfactoryModuleUrl },
  );

  let summary = buildFactoryEntrypointSummary(
    options,
    brief,
    targetRealm,
    seedResult,
  );

  // Run the issue-driven loop
  let loopFn = dependencies?.runIssueLoop ?? runFactoryIssueLoop;
  let loopResult = await loopFn({
    briefUrl: options.briefUrl,
    targetRealmUrl: targetRealm.url,
    realmServerUrl: targetRealm.serverUrl,
    ownerUsername: targetRealm.ownerUsername,
    authorization: targetRealm.authorization,
    model: options.model,
    debug: options.debug,
    retryBlocked: options.retryBlocked,
    fetch: dependencies?.fetch,
  });

  summary.issueLoop = {
    outcome: loopResult.outcome,
    outerCycles: loopResult.outerCycles,
    issueResults: loopResult.issueResults.map((ir) => ({
      issueId: ir.issueId,
      exitReason: ir.exitReason,
      innerIterations: ir.innerIterations,
      toolCallCount: ir.toolCallLog.length,
    })),
  };

  let succeeded = loopResult.outcome === 'all_issues_done';
  summary.result = {
    status: succeeded ? 'completed' : 'failed',
    nextStep: succeeded ? 'all-issues-completed' : `loop-${loopResult.outcome}`,
  };

  return summary;
}

export function buildFactoryEntrypointSummary(
  _options: FactoryEntrypointOptions,
  brief: FactoryBrief,
  targetRealm: FactoryTargetRealmBootstrapResult,
  seedResult: SeedIssueResult,
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
      name: 'created-seed-issue',
      status: 'ok',
      detail: `${seedResult.issueId} (${seedResult.status})`,
    },
  ];

  return {
    command: 'factory:go',
    brief: {
      ...brief,
      url: brief.sourceUrl,
    },
    targetRealm: {
      url: targetRealm.url,
      ownerUsername: targetRealm.ownerUsername,
    },
    seedIssue: {
      seedIssueId: seedResult.issueId,
      seedIssueStatus: seedResult.status,
    },
    actions,
    result: {
      status: 'ready',
      nextStep: 'run-issue-loop',
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

function normalizeUrl(rawUrl: string, flagName: string): string {
  try {
    return new URL(rawUrl).href;
  } catch (_error) {
    throw new FactoryEntrypointUsageError(
      `Expected ${flagName} to be an absolute URL, received: ${rawUrl}`,
    );
  }
}
