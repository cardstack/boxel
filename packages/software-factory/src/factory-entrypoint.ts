import { parseArgs as parseNodeArgs } from 'node:util';

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { inferDarkfactoryModuleUrl } from './factory-seed';
import { parseAgentFlag, type FactoryAgentProvider } from './factory-agent';
import { loadFactoryBrief, type FactoryBrief } from './factory-brief';
import { FactoryEntrypointUsageError } from './factory-entrypoint-errors';
import {
  assertAgentProviderImplemented,
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
import { logger } from './logger';
import { ensureWorkspaceDir, resolveWorkspaceDir } from './workspace-fs';

let log = logger('factory-entrypoint');

export interface FactoryEntrypointOptions {
  briefUrl: string;
  targetRealmUrl: string | null;
  realmServerUrl: string | null;
  agent: FactoryAgentProvider;
  /** Only set when agent === 'openrouter' and the flag carried a `=<id>` suffix. */
  openRouterModel?: string;
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
    options: {
      client: BoxelCLIClient;
      darkfactoryModuleUrl: string;
      workspaceDir: string;
    },
  ) => Promise<SeedIssueResult>;
  runIssueLoop?: (config: IssueLoopWiringConfig) => Promise<IssueLoopResult>;
  /**
   * Override the workspace directory resolution. Primarily for tests so
   * they can point the factory at a temp dir they control. In production
   * this defaults to `resolveWorkspaceDir(targetRealmUrl)`.
   */
  resolveWorkspaceDir?: (targetRealmUrl: string) => string;
  /**
   * Pull the target realm into the workspace. Tests stub this out so
   * they don't make real HTTP calls. Defaults to `client.pull`.
   */
  pullTargetRealm?: (
    client: BoxelCLIClient,
    realmUrl: string,
    workspaceDir: string,
  ) => Promise<void>;
  /**
   * Push the workspace to the target realm (prefer-local). Tests stub
   * this out. Defaults to `client.sync({ preferLocal: true })`.
   */
  syncWorkspaceToRealm?: (
    client: BoxelCLIClient,
    realmUrl: string,
    workspaceDir: string,
  ) => Promise<void>;
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
    '  --realm-server-url <url>   Realm server URL (default: from active Boxel profile)',
    '  --no-retry-blocked          Skip retrying blocked issues (by default, blocked issues are reset to backlog)',
    '  --agent <provider>          LLM backend: "claude" (default, uses Claude Code Agent SDK),',
    '                              "codex" (not yet implemented — tracked in CS-10594),',
    '                              "openrouter" (defaults to anthropic/claude-opus-4),',
    '                              or "openrouter=<model-id>" to pick a specific OpenRouter model',
    '                              (e.g., "openrouter=anthropic/claude-sonnet-4").',
    '  --debug                     Log LLM prompts and responses to stderr',
    '  --help                      Show this usage information',
    '',
    'Auth:',
    '  Authentication uses the active Boxel profile (see: boxel profile add).',
    '  The target realm owner is determined from the active profile username.',
    '  For public briefs, no further auth setup is needed.',
    '  For private briefs, factory:go authenticates via the active Boxel profile.',
    '  The realm server URL comes from --realm-server-url, or the active Boxel profile.',
    '  It is never inferred from --target-realm-url.',
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
        agent: {
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

  let agentRaw =
    typeof parsed.values.agent === 'string' ? parsed.values.agent : undefined;
  let parsedAgent;
  try {
    parsedAgent = parseAgentFlag(agentRaw);
  } catch (error) {
    throw new FactoryEntrypointUsageError(
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    briefUrl: normalizeUrl(briefUrl, '--brief-url'),
    targetRealmUrl: normalizeUrl(targetRealmUrl, '--target-realm-url'),
    realmServerUrl,
    agent: parsedAgent.provider,
    openRouterModel: parsedAgent.openRouterModel,
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
  // Reject unsupported agent backends before any realm/brief side effects
  // run — otherwise `--agent codex` would create a seed issue and mutate
  // the target realm only to fail later when the loop tries to build the
  // (unimplemented) agent.
  assertAgentProviderImplemented(options.agent);

  let targetRealmResolution = (
    dependencies?.resolveTargetRealm ?? resolveFactoryTargetRealm
  )({
    targetRealmUrl: options.targetRealmUrl,
    realmServerUrl: options.realmServerUrl,
  });

  let client = new BoxelCLIClient();

  let brief = await loadFactoryBrief(options.briefUrl, {
    client,
    fetch: dependencies?.fetch,
  });

  let targetRealm = await (
    dependencies?.bootstrapTargetRealm ?? bootstrapFactoryTargetRealm
  )(targetRealmResolution);

  let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealm.url);

  // Establish the local workspace for target-realm I/O. Every factory
  // read/write against the target realm happens against this directory;
  // the realm itself is reached only via `client.pull` / `client.sync`.
  // The path is deterministic per realm so re-runs reuse state.
  let workspaceDir = (dependencies?.resolveWorkspaceDir ?? resolveWorkspaceDir)(
    targetRealm.url,
  );
  await ensureWorkspaceDir(workspaceDir);
  log.info(`Workspace directory: ${workspaceDir}`);

  let pullTargetRealm = dependencies?.pullTargetRealm ?? defaultPullTargetRealm;
  await pullTargetRealm(client, targetRealm.url, workspaceDir);

  // Create the seed issue locally
  let seedResult = await (dependencies?.createSeed ?? createSeedIssue)(
    brief,
    targetRealm.url,
    { client, darkfactoryModuleUrl, workspaceDir },
  );

  // Push the freshly-written seed (and any other pre-existing workspace
  // state) to the realm so the scheduler's `listIssues()` query sees it.
  let syncWorkspaceToRealm =
    dependencies?.syncWorkspaceToRealm ?? defaultSyncWorkspaceToRealm;
  await syncWorkspaceToRealm(client, targetRealm.url, workspaceDir);

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
    client,
    workspaceDir,
    agent: options.agent,
    openRouterModel: options.openRouterModel,
    debug: options.debug,
    retryBlocked: options.retryBlocked,
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

async function defaultPullTargetRealm(
  client: BoxelCLIClient,
  realmUrl: string,
  workspaceDir: string,
): Promise<void> {
  let result = await client.pull(realmUrl, workspaceDir);
  if (result.error) {
    throw new Error(
      `Failed to pull target realm into workspace ${workspaceDir}: ${result.error}`,
    );
  }
  log.info(
    `Pulled ${result.files.length} file(s) from target realm into workspace`,
  );
}

async function defaultSyncWorkspaceToRealm(
  client: BoxelCLIClient,
  realmUrl: string,
  workspaceDir: string,
): Promise<void> {
  let result = await client.sync(realmUrl, workspaceDir, {
    preferLocal: true,
  });
  if (result.error) {
    throw new Error(`Failed to sync workspace to realm: ${result.error}`);
  }
  if (result.hasError) {
    log.warn(
      'Workspace sync completed with errors — see prior log lines for details',
    );
  }
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
