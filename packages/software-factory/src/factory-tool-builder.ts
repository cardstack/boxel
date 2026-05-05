/**
 * Factory tool builder — builds FactoryTool[] from config.
 *
 * Wraps realm operations, script/realm-api tools, and control signals as
 * executable tool functions that the agent calls directly via the LLM's
 * native tool-use protocol. Each tool's execute function enforces safety
 * (realm protection, per-realm JWT auth, logging).
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  runEvaluateInMemory,
  type RunEvaluateInMemoryOptions,
  type RunEvaluateResult,
} from './eval-execution';
import type { ToolExecutor } from './factory-tool-executor';
import type { ToolRegistry } from './factory-tool-registry';
import {
  runInstantiateInMemory,
  type RunInstantiateInMemoryOptions,
  type RunInstantiateResult,
} from './instantiate-execution';
import {
  runLintInMemory,
  type RunLintInMemoryOptions,
  type RunLintResult,
} from './lint-execution';
import {
  runParseInMemory,
  type RunParseInMemoryOptions,
  type RunParseResult,
} from './parse-execution';
import { runTestsInMemory } from './test-run-execution';
import type { RunTestsInMemoryOptions, RunTestsResult } from './test-run-types';
import { readCard, writeCard } from './workspace-fs';

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
   * builder (read_file, search_realm, run_lint, the structured update
   * tools, signals, …). `'registered'` is for tools wrapped from the
   * `ToolRegistry`'s script + realm-api manifests (realm-read,
   * search-realm, boxel-sync, …).
   *
   * The Claude backend filters out `'registered'` tools because they
   * shadow the core ones with kebab-case duplicates the model picks at
   * random — and most of them are reachable through native fs / Bash +
   * boxel CLI anyway. OpenRouter still gets every tool.
   */
  source?: 'core' | 'registered';
}

export interface ToolBuilderConfig {
  targetRealmUrl: string;
  /** Boxel CLI client — owns all realm auth and API calls. */
  client: BoxelCLIClient;
  /**
   * Local workspace directory mirroring the target realm. All target-realm
   * card reads/writes happen here; sync with the realm is orchestrated
   * elsewhere in the loop.
   */
  workspaceDir: string;
  /** Module URL for the TestRun card definition (e.g., `<realmUrl>test-results`). */
  testResultsModuleUrl?: string;
  /** Realm server URL. Required — never inferred from realm URLs. */
  realmServerUrl: string;
  /** Host app URL for QUnit test runner. Defaults to realmServerUrl (compat proxy). */
  hostAppUrl?: string;
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
  let tools: FactoryTool[] = [
    buildWriteFileTool(config),
    buildReadFileTool(config),
    buildFetchTranspiledModuleTool(config),
    buildSearchRealmTool(config),
    buildRunCommandTool(config),
    buildRunLintTool(config),
    buildRunTestsTool(config),
    buildRunEvaluateTool(config),
    buildRunParseTool(config),
    buildRunInstantiateTool(config),
    buildSignalDoneTool(),
    buildRequestClarificationTool(),
  ];

  // Tracker-schema cards (Project / Issue / KnowledgeArticle / Spec /
  // issue comments) used to have dedicated wrapper tools here that
  // auto-constructed the JSON:API document, enforced Issue-description
  // immutability, and so on. CS-10883 retired all five; the agent now
  // writes those `.json` files directly via `Write` (Claude) /
  // `write_file` (OpenRouter). The shapes and invariants are taught in
  // the `software-factory-bootstrap` and `software-factory-operations`
  // skills, with the live `darkfactoryModuleUrl` named in the system
  // prompt for `adoptsFrom.module`.

  // Add registered realm-api tools as FactoryTool wrappers. After the
  // CS-10883 retirements the registry only contains `realm-create`;
  // anything else added later goes through the same build path.
  for (let manifest of toolRegistry.getManifests()) {
    if (manifest.category === 'realm-api') {
      tools.push(buildRegisteredTool(manifest, toolExecutor, config));
    }
  }

  return tools;
}

// ---------------------------------------------------------------------------
// Argument validation helpers
// ---------------------------------------------------------------------------

/**
 * Enforce that a required string argument is present and non-empty. Returns
 * the trimmed value or throws a clear error that propagates back to the
 * model as a tool-call result. This is the only runtime guardrail against
 * an LLM emitting a malformed tool call like `write_file({})` — the JSON
 * Schema `required` declaration is advisory for OpenRouter's tool-use and
 * the model can still send empty args. Without this check, path strings
 * like `"undefined"` would end up at the realm's root (e.g., a file named
 * `<realm>/undefined`).
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

function buildWriteFileTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'write_file',
    description:
      'Write a file to the target realm workspace. The path must include the file extension. Writes go to the local workspace and are synced to the realm between iterations.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Realm-relative file path with extension (e.g., "my-card.gts", "Card/1.json")',
        },
        content: { type: 'string', description: 'File content' },
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to write to (default: target)',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      let path = requireStringArg(args, 'path', 'write_file');
      let content = requireStringArg(args, 'content', 'write_file');
      return writeCard(config.workspaceDir, path, content);
    },
  };
}

function buildReadFileTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'read_file',
    description:
      'Read a file from the target realm workspace. Returns parsed JSON when possible, otherwise raw text.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Realm-relative file path',
        },
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to read from (default: target)',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      let path = requireStringArg(args, 'path', 'read_file');
      return readCard(config.workspaceDir, path);
    },
  };
}

function buildFetchTranspiledModuleTool(
  config: ToolBuilderConfig,
): FactoryTool {
  return {
    name: 'fetch_transpiled_module',
    description:
      "Debugging tool ONLY for investigating runtime errors in .gts modules you've written. Use when an eval or instantiate validation error reports a line/column number — those line numbers refer to the transpiled output, not your .gts source, so fetching the transpiled output is how you locate the offending source construct. Never use the transpiled output as a reference for how to write code. Do NOT copy its patterns (setComponentTemplate, precompileTemplate, wire-format templates, base64 CSS imports) into source — always write idiomatic Ember / <template>-tag / CardDef source. Editing: only edit the .gts source (the transpiled output is regenerated on the next write). Auth: per-realm JWT.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Realm-relative module path. The .gts extension is optional — the realm accepts either form.',
        },
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to read from (default: target)',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      let path = requireStringArg(args, 'path', 'fetch_transpiled_module');
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      return config.client.readTranspiled(realmUrl, path);
    },
  };
}

function buildSearchRealmTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'search_realm',
    description:
      'Search for cards in a realm using a structured query. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'object',
          description: 'Search query object (filter, sort, page)',
        },
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to search (default: target)',
        },
      },
      required: ['query'],
    },
    execute: async (args) => {
      let query = args.query as Record<string, unknown>;
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      let result = await config.client.search(realmUrl, query);
      return result.ok ? { data: result.data } : { error: result.error };
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
      return execute({
        targetRealmUrl: config.targetRealmUrl,
        client: config.client,
        hostAppUrl: config.hostAppUrl ?? config.realmServerUrl,
      });
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
      'one file. Safe to call repeatedly for mid-turn self-validation — ' +
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
      return execute({
        targetRealmUrl: config.targetRealmUrl,
        client: config.client,
        workspaceDir: config.workspaceDir,
        ...(path ? { path } : {}),
      });
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
      'for a quick self-check right after writing one module. Safe to ' +
      'call repeatedly for mid-turn self-validation — this tool does NOT ' +
      'create an EvalResult card or any other realm artifact. The ' +
      'orchestrator still runs the full validation pipeline (which writes ' +
      'an EvalResult card) automatically after signal_done, so calling ' +
      'this is optional. When a failure reports a line/column, those ' +
      'numbers refer to the transpiled module — use `fetch_transpiled_module` ' +
      'to locate the offending source construct, then fix the .gts source ' +
      '(never copy transpiled patterns back into source). Auth: realm ' +
      'server token.',
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
      // `run_evaluate` runs in the prerenderer sandbox and reads modules
      // from the realm, so it doesn't need the workspace.
      return execute({
        targetRealmUrl: config.targetRealmUrl,
        realmServerUrl: config.realmServerUrl,
        client: config.client,
        ...(path ? { path } : {}),
      });
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
      'run can be fed straight back into "path" verbatim. Safe to call ' +
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
      return execute({
        targetRealmUrl: config.targetRealmUrl,
        client: config.client,
        workspaceDir: config.workspaceDir,
        ...(path ? { path } : {}),
      });
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
      'only that single realm-relative `.json` example file — its ' +
      '`meta.adoptsFrom` supplies the module + card name, and spec discovery ' +
      'is skipped entirely so the agent can self-check one instance in ' +
      'isolation. The path must end in `.json`. Safe to call repeatedly for ' +
      'mid-turn self-validation — this tool does NOT create an ' +
      'InstantiateResult card or any other realm artifact. The orchestrator ' +
      'still runs the full validation pipeline (which writes an ' +
      'InstantiateResult card) automatically after signal_done, so calling ' +
      'this is optional. When a failure reports a line/column, those numbers ' +
      'refer to the transpiled module — use `fetch_transpiled_module` to ' +
      'locate the offending source construct, then fix the .gts source ' +
      '(never copy transpiled patterns back into source). Auth: realm server ' +
      'token.',
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
      return execute({
        targetRealmUrl: config.targetRealmUrl,
        realmServerUrl: config.realmServerUrl,
        client: config.client,
        workspaceDir: config.workspaceDir,
        ...(path ? { path } : {}),
      });
    },
  };
}

function buildSignalDoneTool(): FactoryTool {
  return {
    name: 'signal_done',
    description:
      'Signal that the current ticket is complete. Call this when all implementation and test files have been written.',
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

function buildRunCommandTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'run_command',
    description:
      'Execute a Boxel host command on the realm server via the prerenderer. ' +
      'This runs Boxel host commands ONLY — not shell commands, scripts, or Node.js. ' +
      'Commands must be Boxel host command specifiers in the format ' +
      '"@cardstack/boxel-host/commands/<name>/default". ' +
      'Auth: realm server token.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'Boxel host command specifier — must be in the format "@cardstack/boxel-host/commands/<name>/default"',
        },
        commandInput: {
          type: 'object',
          description: 'Optional input for the command',
        },
      },
      required: ['command'],
    },
    execute: async (args) => {
      return config.client.runCommand(
        config.realmServerUrl,
        config.targetRealmUrl,
        args.command as string,
        args.commandInput as Record<string, unknown> | undefined,
      );
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

function resolveRealmUrl(
  config: ToolBuilderConfig,
  _realm: string | undefined,
): string {
  return config.targetRealmUrl;
}
