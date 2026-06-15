/**
 * Factory tool builder — builds FactoryTool[] from config.
 *
 * Wraps realm operations, script/realm-api tools, and control signals as
 * executable tool functions that the agent calls directly via the LLM's
 * native tool-use protocol. Each tool's execute function enforces safety
 * (realm protection, per-realm JWT auth, logging).
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common/realm-identifiers';

import { fetchCardTypeSchema } from './darkfactory-schemas.ts';
import {
  runEvaluateInMemory,
  type RunEvaluateInMemoryOptions,
  type RunEvaluateResult,
} from './eval-execution.ts';
import type { ToolExecutor } from './factory-tool-executor.ts';
import type { ToolRegistry } from './factory-tool-registry.ts';
import {
  runInstantiateInMemory,
  type RunInstantiateInMemoryOptions,
  type RunInstantiateResult,
} from './instantiate-execution.ts';
import {
  runLintInMemory,
  type RunLintInMemoryOptions,
  type RunLintResult,
} from './lint-execution.ts';
import {
  runParseInMemory,
  type RunParseInMemoryOptions,
  type RunParseResult,
} from './parse-execution.ts';
import { runTestsInMemory } from './test-run-execution.ts';
import type {
  RunTestsInMemoryOptions,
  RunTestsResult,
} from './test-run-types.ts';
import type { ValidationRunCache } from './validation-run-cache.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactoryTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  /**
   * Origin marker. `'core'` is for tools defined directly in this
   * builder (`get_card_schema`, `run_*`, `signal_done`,
   * `request_clarification`). `'registered'` is for tools wrapped
   * from the `ToolRegistry`'s realm-api manifests (currently just
   * `realm-create`); these are filtered out of the agent's hot path
   * since the entrypoint drives the realm-create flow before the
   * agent runs.
   */
  source?: 'core' | 'registered';
}

export interface ToolBuilderConfig {
  targetRealm: string;
  /** Boxel CLI client — owns all realm auth and API calls. */
  client: BoxelCLIClient;
  /**
   * Local workspace directory mirroring the target realm. All target-realm
   * card reads/writes happen here. The orchestrator pushes the workspace
   * to the realm between agent turns; the realm-touching `run_*` tools
   * also call `syncWorkspace` before invoking the prerenderer so a
   * mid-turn evaluate/instantiate/test sees the agent's current writes.
   */
  workspaceDir: string;
  /** Module URL for the TestRun card definition (e.g., `<realmUrl>test-results`). */
  testResultsModuleUrl?: string;
  /** Realm server URL. Required — never inferred from realm URLs. */
  realmServerUrl: string;
  /** Host app URL for QUnit test runner. Defaults to realmServerUrl (compat proxy). */
  hostAppUrl?: string;
  /**
   * Push the local workspace to the target realm. The orchestrator only
   * syncs the workspace between agent turns, so a mid-turn `run_evaluate`
   * / `run_instantiate` / `run_test` would otherwise hit a realm that
   * doesn't yet have the agent's writes from the current turn. The
   * realm-touching `run_*` tools call this before invoking the
   * prerenderer so the realm reflects the agent's latest source.
   */
  syncWorkspace: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Shared with the post-signal_done validation pipeline — memoizes
   * validation-engine runs per workspace fingerprint so the same unchanged
   * realm state isn't validated twice (once by the agent's run_* tools,
   * once by the pipeline).
   */
  validationCache?: ValidationRunCache;
  /** Injected for testing — defaults to runLintInMemory. */
  runLintInMemory?: (options: RunLintInMemoryOptions) => Promise<RunLintResult>;
  /** Injected for testing — defaults to runTestsInMemory. */
  runTestsInMemory?: (
    options: RunTestsInMemoryOptions,
  ) => Promise<RunTestsResult>;
  /** Injected for testing — defaults to runEvaluateInMemory. */
  runEvaluateInMemory?: (
    options: RunEvaluateInMemoryOptions,
  ) => Promise<RunEvaluateResult>;
  /** Injected for testing — defaults to runParseInMemory. */
  runParseInMemory?: (
    options: RunParseInMemoryOptions,
  ) => Promise<RunParseResult>;
  /** Injected for testing — defaults to runInstantiateInMemory. */
  runInstantiateInMemory?: (
    options: RunInstantiateInMemoryOptions,
  ) => Promise<RunInstantiateResult>;
}

export interface ToolCallEntry {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Signals — returned by signal tools to indicate control flow
// ---------------------------------------------------------------------------

export const DONE_SIGNAL = Symbol.for('factory:done');
export const CLARIFICATION_SIGNAL = Symbol.for('factory:clarification');

export interface DoneResult {
  signal: typeof DONE_SIGNAL;
}

export interface ClarificationResult {
  signal: typeof CLARIFICATION_SIGNAL;
  message: string;
}

// ---------------------------------------------------------------------------
// ToolBuilder
// ---------------------------------------------------------------------------

/**
 * Build the set of FactoryTool[] that the agent can call during its turn.
 * Each tool wraps a realm operation or script execution with auth + safety.
 */
export function buildFactoryTools(
  config: ToolBuilderConfig,
  toolExecutor: ToolExecutor,
  toolRegistry: ToolRegistry,
): FactoryTool[] {
  // Filesystem and shell are owned by the agent backend (Claude Agent
  // SDK or opencode) via native tools. The factory contributes
  // `get_card_schema` (introspects a live `CardDef` via the
  // realm-server prerenderer — no Bash equivalent), the validation
  // run_* tools, and the two control signals. Tracker-schema cards
  // (Project / Issue / KnowledgeArticle / Spec / issue comments) are
  // written as plain JSON via the backend's native `Write` after
  // schema introspection; the shapes and invariants live in the
  // `software-factory-bootstrap` and `software-factory-operations`
  // skills.
  let tools: FactoryTool[] = [
    buildGetCardSchemaTool(config),
    buildRunLintTool(config),
    buildRunTestsTool(config),
    buildRunEvaluateTool(config),
    buildRunParseTool(config),
    buildRunInstantiateTool(config),
    buildSignalDoneTool(),
    buildRequestClarificationTool(),
  ];

  // Wrap registered realm-api manifests (currently just `realm-create`).
  // Tracker-schema cards (Project / IssueTracker / Issue / KnowledgeArticle /
  // Spec / issue comments) used to have dedicated wrapper tools here that
  // auto-constructed the JSON:API document, enforced Issue-description
  // immutability, etc. CS-10883 retired all five; the agent now writes
  // those `.json` files directly via `Write`. The shapes and invariants are
  // taught in the `software-factory-bootstrap` and
  // `software-factory-operations` skills, with the live
  // `darkfactoryModuleUrl` named in the system prompt for
  // `adoptsFrom.module`.
  for (let manifest of toolRegistry.getManifests()) {
    if (manifest.category === 'realm-api') {
      tools.push(buildRegisteredTool(manifest, toolExecutor, config));
    }
  }

  return tools;
}

/**
 * Push the local workspace to the realm before a `run_*` tool invokes the
 * prerenderer. Native `Write` tool calls only land in the workspace until
 * the orchestrator's between-turn sync, so a mid-turn realm-touching tool
 * would otherwise see a realm without the agent's own writes from this
 * turn. Callers receive a string error message on failure so they can
 * surface it to the agent through their result shape.
 */
async function syncWorkspaceForToolRun(
  config: ToolBuilderConfig,
  toolName: string,
): Promise<string | undefined> {
  let result = await config.syncWorkspace();
  if (result.ok) return undefined;
  return `Failed to sync workspace to realm before ${toolName}: ${result.error ?? 'unknown error'}`;
}

/**
 * A whole-realm `run_*` result that "passed" while checking zero
 * files/modules/instances/tests is vacuous: it usually means the realm
 * doesn't yet contain the files the agent intends to validate (a sync
 * that hasn't landed, an index still catching up, or files that were
 * never written) — not that the realm is genuinely clean. The agent
 * must never count it as green, so the tools rewrite it into an error
 * result. Single-file runs are exempt: an explicit `path` either
 * resolves to one checked file or errors on its own.
 */
function vacuousPassMessage(toolName: string, what: string): string {
  return (
    `${toolName} found nothing to check (0 ${what}) — this is NOT a ` +
    'pass. This tool already synced your workspace before running, ' +
    "so either the realm index hasn't caught up yet (re-run this " +
    `tool) or the ${what} you intend to validate were never ` +
    'written. A green result must check at least one of them.'
  );
}

// ---------------------------------------------------------------------------
// Argument validation helpers
// ---------------------------------------------------------------------------

/**
 * Enforce that a required string argument is present and non-empty. Returns
 * the trimmed value or throws a clear error that propagates back to the
 * model as a tool-call result. The JSON Schema `required` declaration is
 * advisory — the model can still send empty args — so this is the runtime
 * guardrail that keeps a malformed tool call (e.g. `get_card_schema({})`)
 * from sliding through with a `"undefined"` path or name.
 */
export function requireStringArg(
  args: Record<string, unknown>,
  name: string,
  toolName: string,
): string {
  let raw = args[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      `Tool "${toolName}" requires a non-empty string "${name}" argument; received ${JSON.stringify(raw)}. ` +
        `Re-send the tool call with every required argument filled in.`,
    );
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Factory-level tools
// ---------------------------------------------------------------------------

function buildGetCardSchemaTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'get_card_schema',
    description:
      'Fetch the live JSON Schema (attributes + relationships) for a card ' +
      'definition by its CodeRef. Returns `{ attributes, relationships? }` ' +
      'with field names, types, and enum values introspected from the ' +
      'actual `CardDef` at runtime — never hard-coded. Use this BEFORE ' +
      'writing a tracker JSON file (Project, IssueTracker, Issue, KnowledgeArticle, ' +
      'Spec, etc.) so the document you write matches the live schema, ' +
      'even when the schema evolves. Schemas are fetched via the realm ' +
      'server prerenderer (the same path the AI Bot uses) and cached ' +
      'per-process, so repeated calls with the same code ref are cheap.',
    parameters: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          description:
            'Absolute module URL of the card definition (e.g. the live ' +
            '`darkfactoryModuleUrl` from the system prompt for tracker ' +
            'cards, or `https://cardstack.com/base/spec` for catalog Spec).',
        },
        name: {
          type: 'string',
          description:
            'Exported card name within the module (e.g. `Project`, ' +
            '`Issue`, `KnowledgeArticle`, `Spec`).',
        },
      },
      required: ['module', 'name'],
    },
    execute: async (args) => {
      let module = requireStringArg(args, 'module', 'get_card_schema');
      let name = requireStringArg(args, 'name', 'get_card_schema');
      let schema = await fetchCardTypeSchema(
        config.client,
        config.realmServerUrl,
        config.targetRealm,
        { module: module as RealmResourceIdentifier, name },
      );
      if (!schema) {
        return {
          ok: false,
          error: `Failed to fetch schema for ${module}#${name}. Verify the module URL is reachable from the target realm and that the named export is a CardDef.`,
        };
      }
      return { ok: true, schema };
    },
  };
}

function buildRunTestsTool(config: ToolBuilderConfig): FactoryTool {
  let execute = config.runTestsInMemory ?? runTestsInMemory;
  return {
    name: 'run_tests',
    description:
      "Run the realm's QUnit tests against the target realm and return an " +
      'in-memory result object (status, pass/fail counts, failure details). ' +
      'Safe to call repeatedly for mid-turn self-validation — this tool does ' +
      'NOT create a TestRun card or any other realm artifact. The ' +
      'orchestrator still runs the full validation pipeline (which writes a ' +
      'TestRun card) automatically after signal_done, so calling this is ' +
      'optional. Takes no arguments — runs all *.test.gts files in the ' +
      'target realm. Auth: per-realm JWT.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      let syncError = await syncWorkspaceForToolRun(config, 'run_tests');
      if (syncError) {
        return {
          status: 'error',
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 0,
          testFiles: [],
          failures: [],
          errorMessage: syncError,
        };
      }
      let result = await execute({
        targetRealm: config.targetRealm,
        client: config.client,
        hostAppUrl: config.hostAppUrl ?? config.realmServerUrl,
        cache: config.validationCache,
      });
      if (result.status === 'passed' && result.testFiles.length === 0) {
        return {
          ...result,
          status: 'error' as const,
          errorMessage: vacuousPassMessage('run_tests', 'test files'),
        };
      }
      return result;
    },
  };
}

function buildRunLintTool(config: ToolBuilderConfig): FactoryTool {
  let execute = config.runLintInMemory ?? runLintInMemory;
  return {
    name: 'run_lint',
    description:
      'Run ESLint + Prettier (with @cardstack/boxel rules) and return an ' +
      'in-memory result (status, error/warning counts, per-violation ' +
      'details). Without "path", lints every .gts / .gjs / .ts / .js file ' +
      'in the target realm. With "path", lints only that single realm-' +
      'relative file — handy for a quick self-check right after writing ' +
      'one file. The tool pushes your workspace to the realm before ' +
      'linting so files you just wrote are visible — the same sync the ' +
      'orchestrator runs after signal_done, brought forward. ' +
      'Safe to call repeatedly for mid-turn self-validation — ' +
      'this tool does NOT create a LintResult card or any other realm ' +
      'artifact. The orchestrator still runs the full validation pipeline ' +
      '(which writes a LintResult card) automatically after signal_done, ' +
      'so calling this is optional. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional realm-relative path to a single .gts / .gjs / .ts / .js file to lint. Omit to lint every lintable file in the target realm.',
        },
      },
    },
    execute: async (args) => {
      let rawPath = args.path;
      let path =
        typeof rawPath === 'string' && rawPath.trim() !== ''
          ? rawPath.trim()
          : undefined;
      let syncError = await syncWorkspaceForToolRun(config, 'run_lint');
      if (syncError) {
        return {
          status: 'error',
          filesChecked: 0,
          filesWithErrors: 0,
          errorCount: 0,
          warningCount: 0,
          durationMs: 0,
          lintableFiles: [],
          violations: [],
          errorMessage: syncError,
        };
      }
      let result = await execute({
        targetRealm: config.targetRealm,
        client: config.client,
        workspaceDir: config.workspaceDir,
        cache: config.validationCache,
        ...(path ? { path } : {}),
      });
      if (!path && result.status === 'passed' && result.filesChecked === 0) {
        return {
          ...result,
          status: 'error' as const,
          errorMessage: vacuousPassMessage('run_lint', 'lintable files'),
        };
      }
      return result;
    },
  };
}

function buildRunEvaluateTool(config: ToolBuilderConfig): FactoryTool {
  let execute = config.runEvaluateInMemory ?? runEvaluateInMemory;
  return {
    name: 'run_evaluate',
    description:
      'Evaluate ESM modules (.gts / .gjs / .ts / .js) in the target realm ' +
      'via the prerenderer sandbox and return an in-memory result (status, ' +
      'module counts, per-failure error + stackTrace). Without "path", ' +
      'evaluates every non-test evaluable module in the realm. With ' +
      '"path", evaluates only that single realm-relative file — handy ' +
      'for a quick self-check right after writing one module. The tool ' +
      'pushes your workspace to the realm before evaluating so files you ' +
      'just wrote are visible to the prerender sandbox — the same sync ' +
      'the orchestrator runs after signal_done, brought forward. Safe to ' +
      'call repeatedly for mid-turn self-validation — this tool does NOT ' +
      'create an EvalResult card or any other validation artifact. The ' +
      'orchestrator still runs the full validation pipeline (which writes ' +
      'an EvalResult card) automatically after signal_done, so calling ' +
      'this is optional. When a failure reports a line/column, those ' +
      'numbers refer to the transpiled module — fetch the transpiled ' +
      'output via Bash + `boxel read-transpiled <path> --realm <url>` ' +
      'to locate the offending source construct, then fix the .gts ' +
      'source (never copy transpiled patterns back into source). ' +
      'Auth: realm server token.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional realm-relative path to a single .gts / .gjs / .ts / .js file to evaluate. Omit to evaluate every non-test evaluable module in the target realm. Test files (*.test.*) are rejected — the test runner validates those.',
        },
      },
    },
    execute: async (args) => {
      let rawPath = args.path;
      let path =
        typeof rawPath === 'string' && rawPath.trim() !== ''
          ? rawPath.trim()
          : undefined;
      let syncError = await syncWorkspaceForToolRun(config, 'run_evaluate');
      if (syncError) {
        return {
          status: 'error',
          modulesChecked: 0,
          modulesWithErrors: 0,
          durationMs: 0,
          evaluableFiles: [],
          failures: [],
          errorMessage: syncError,
        };
      }
      let result = await execute({
        targetRealm: config.targetRealm,
        realmServerUrl: config.realmServerUrl,
        client: config.client,
        cache: config.validationCache,
        ...(path ? { path } : {}),
      });
      if (!path && result.status === 'passed' && result.modulesChecked === 0) {
        return {
          ...result,
          status: 'error' as const,
          errorMessage: vacuousPassMessage('run_evaluate', 'evaluable modules'),
        };
      }
      return result;
    },
  };
}

function buildRunParseTool(config: ToolBuilderConfig): FactoryTool {
  let execute = config.runParseInMemory ?? runParseInMemory;
  return {
    name: 'run_parse',
    description:
      'Parse and type-check files in the target realm and return an ' +
      'in-memory result (status, error counts, per-error file/line/column/' +
      'message). Without "path", runs glint (ember-tsc) over every .gts / ' +
      '.gjs / .ts file in the realm AND validates every .json file listed ' +
      'as a Spec linkedExample (same discovery as the parse validation ' +
      'step). With "path", parses only that single realm-relative file — ' +
      '.gts / .gjs / .ts files are type-checked via glint, .json files ' +
      'are parsed and checked for card document structure. The extension ' +
      'is required (paths without one are rejected) — whole-realm ' +
      'discovery already normalizes Spec linkedExamples to include .json, ' +
      'so the "parseableFiles" entries returned by a prior whole-realm ' +
      'run can be fed straight back into "path" verbatim. The tool ' +
      'pushes your workspace to the realm before parsing so files you ' +
      'just wrote are visible — the same sync the orchestrator runs ' +
      'after signal_done, brought forward. CAVEAT on single-file runs: ' +
      'a file is type-checked in isolation, so a file that imports ' +
      'same-realm siblings (e.g. a component that `import type`s the ' +
      'card module) can report cross-file resolution errors that a ' +
      'whole-realm run does not. Whole-realm parse is the source of ' +
      'truth — when a single-file run fails only on imports of files ' +
      'you know exist, re-run without "path" instead of chasing the ' +
      'errors. Safe to call ' +
      'repeatedly for mid-turn self-validation — this tool does NOT ' +
      'create a ParseResult card or any other realm artifact. The ' +
      'orchestrator still runs the full validation pipeline (which writes ' +
      'a ParseResult card) automatically after signal_done, so calling ' +
      'this is optional. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional realm-relative path to a single file to parse. Must end in .gts / .gjs / .ts / .json (paths without an extension are rejected). Omit to parse every parseable file (GTS modules + Spec-linked JSON examples) in the target realm.',
        },
      },
    },
    execute: async (args) => {
      let rawPath = args.path;
      let path =
        typeof rawPath === 'string' && rawPath.trim() !== ''
          ? rawPath.trim()
          : undefined;
      let syncError = await syncWorkspaceForToolRun(config, 'run_parse');
      if (syncError) {
        return {
          status: 'error',
          filesChecked: 0,
          filesWithErrors: 0,
          errorCount: 0,
          durationMs: 0,
          parseableFiles: [],
          errors: [],
          errorMessage: syncError,
        };
      }
      let result = await execute({
        targetRealm: config.targetRealm,
        client: config.client,
        workspaceDir: config.workspaceDir,
        cache: config.validationCache,
        ...(path ? { path } : {}),
      });
      if (!path && result.status === 'passed' && result.filesChecked === 0) {
        return {
          ...result,
          status: 'error' as const,
          errorMessage: vacuousPassMessage('run_parse', 'parseable files'),
        };
      }
      return result;
    },
  };
}

function buildRunInstantiateTool(config: ToolBuilderConfig): FactoryTool {
  let execute = config.runInstantiateInMemory ?? runInstantiateInMemory;
  return {
    name: 'run_instantiate',
    description:
      'Instantiate card example instances in the target realm via the ' +
      'prerenderer sandbox and return an in-memory result (status, instance ' +
      'counts, per-failure error + stackTrace). Without "path", searches the ' +
      'realm for Spec cards and instantiates every linkedExample on every ' +
      'card/app Spec; specs with no linkedExamples still get a bare ' +
      'instantiation to exercise the card class. With "path", instantiates ' +
      'only that single realm-relative `.json` **instance** file — its ' +
      '`meta.adoptsFrom` supplies the module + card name, and spec discovery ' +
      'is skipped entirely so the agent can self-check one instance in ' +
      'isolation. The path must end in `.json`. **Do NOT pass a `Spec/...json` ' +
      'path or any card whose `meta.adoptsFrom.module` is a base-realm URL ' +
      '(`https://cardstack.com/base/...`). Specs adopt from the base realm, ' +
      'and the prerender refuses cross-origin module loads — the call would ' +
      'fail with "moduleUrl origin does not match realmUrl origin". To ' +
      'validate Specs, call this tool WITHOUT a path; it discovers your ' +
      'Specs and exercises their `linkedExamples` against the card class ' +
      'you just wrote.** The tool pushes your workspace to the realm before ' +
      'instantiating so files you just wrote (including the .json example ' +
      'and the card definition it adopts from) are visible to the prerender ' +
      'sandbox. Safe to call repeatedly for mid-turn self-validation — this ' +
      'tool does NOT create an InstantiateResult card or any other ' +
      'validation artifact. The orchestrator still runs the full validation ' +
      'pipeline (which writes an InstantiateResult card) automatically after ' +
      'signal_done, so calling this is optional. When a failure reports a ' +
      'line/column, those numbers refer to the transpiled module — fetch ' +
      'the transpiled output via Bash + `boxel read-transpiled <path> ' +
      '--realm <url>` to locate the offending source construct, then fix ' +
      'the .gts source (never copy transpiled patterns back into source). ' +
      'Auth: realm server token.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional realm-relative path to a single `.json` example instance to instantiate. Omit to instantiate every linkedExample on every Spec card in the target realm. The path must end in `.json` — other extensions are rejected.',
        },
      },
    },
    execute: async (args) => {
      let rawPath = args.path;
      let path =
        typeof rawPath === 'string' && rawPath.trim() !== ''
          ? rawPath.trim()
          : undefined;
      let syncError = await syncWorkspaceForToolRun(config, 'run_instantiate');
      if (syncError) {
        return {
          status: 'error',
          instancesChecked: 0,
          instancesWithErrors: 0,
          durationMs: 0,
          instanceFiles: [],
          failures: [],
          errorMessage: syncError,
        };
      }
      let result = await execute({
        targetRealm: config.targetRealm,
        realmServerUrl: config.realmServerUrl,
        client: config.client,
        workspaceDir: config.workspaceDir,
        cache: config.validationCache,
        ...(path ? { path } : {}),
      });
      if (
        !path &&
        result.status === 'passed' &&
        result.instancesChecked === 0
      ) {
        return {
          ...result,
          status: 'error' as const,
          errorMessage: vacuousPassMessage(
            'run_instantiate',
            'Spec-linked instances',
          ),
        };
      }
      return result;
    },
  };
}

function buildSignalDoneTool(): FactoryTool {
  return {
    name: 'signal_done',
    description:
      'Signal that the current issue is complete. Call this when all implementation and test files have been written.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      return { signal: DONE_SIGNAL } as DoneResult;
    },
  };
}

function buildRequestClarificationTool(): FactoryTool {
  return {
    name: 'request_clarification',
    description:
      'Signal that you cannot proceed and need human input. Provide a description of what is blocking.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Description of what clarification is needed',
        },
      },
      required: ['message'],
    },
    execute: async (args) => {
      return {
        signal: CLARIFICATION_SIGNAL,
        message: args.message as string,
      } as ClarificationResult;
    },
  };
}

// ---------------------------------------------------------------------------
// Registered tool wrappers (script + realm-api)
// ---------------------------------------------------------------------------

function buildRegisteredTool(
  manifest: {
    name: string;
    description: string;
    category: string;
    args: {
      name: string;
      type: string;
      required: boolean;
      description: string;
    }[];
  },
  toolExecutor: ToolExecutor,
  _config: ToolBuilderConfig,
): FactoryTool {
  let properties: Record<string, unknown> = {};
  let required: string[] = [];

  for (let arg of manifest.args) {
    properties[arg.name] = {
      type: arg.type,
      description: arg.description,
    };
    if (arg.required) {
      required.push(arg.name);
    }
  }

  return {
    name: manifest.name,
    description: manifest.description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    execute: async (args) => {
      return toolExecutor.execute(manifest.name, args);
    },
    source: 'registered',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
