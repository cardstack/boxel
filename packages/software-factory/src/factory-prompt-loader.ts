import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import type {
  AgentAction,
  AgentContext,
  ChatMessage,
  ResolvedSkill,
  ToolManifest,
  ToolResult,
} from './factory-agent/index.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMPTS_DIR = resolve(import.meta.dirname, '../prompts');

// ---------------------------------------------------------------------------
// PromptLoader
// ---------------------------------------------------------------------------

export interface PromptLoader {
  load(templateName: string, variables: Record<string, unknown>): string;
}

export class FilePromptLoader implements PromptLoader {
  private cache: Map<string, string> = new Map();
  private promptsDir: string;

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir ?? PROMPTS_DIR;
  }

  /**
   * Load a template by name, interpolate variables, and return the result.
   * Template names map to files: "system" → "system.md", "action-schema" → "action-schema.md"
   */
  load(templateName: string, variables: Record<string, unknown>): string {
    let raw = this.readTemplate(templateName);
    return interpolate(raw, variables);
  }

  /** Read and cache a raw template file. */
  private readTemplate(name: string): string {
    let cached = this.cache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    let filePath = join(this.promptsDir, `${name}.md`);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new PromptTemplateNotFoundError(
        `Prompt template "${name}" not found at ${filePath}`,
      );
    }

    this.cache.set(name, content);
    return content;
  }

  /** Clear the template cache (useful for testing). */
  clearCache(): void {
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

/**
 * Minimal mustache-like template interpolation.
 *
 * Supports:
 * - {{variable}} — simple value substitution (dot paths: {{a.b}})
 * - {{#each items}} ... {{/each}} — iterate over arrays
 * - {{#if value}} ... {{/if}} — conditional blocks
 * - {{.}} — current item in an #each block over a string array
 */
export function interpolate(
  template: string,
  variables: Record<string, unknown>,
): string {
  let result = template;

  // Process {{#each ...}} blocks first — they recursively handle nested
  // {{#if}} and {{#each}} blocks within their body using the item context.
  // This must happen before top-level {{#if}} processing so that {{#if}}
  // blocks inside {{#each}} are resolved with the correct item variables.
  result = processEachBlocks(result, variables);

  // Process remaining top-level {{#if ...}} blocks
  result = processIfBlocks(result, variables);

  // Process simple {{variable}} and {{a.b.c}} substitutions
  result = processVariables(result, variables);

  // Clean up excessive blank lines (3+ consecutive → 2)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

function processIfBlocks(
  template: string,
  variables: Record<string, unknown>,
): string {
  let result = template;
  let prevResult: string;

  do {
    prevResult = result;
    result = replaceOutermostBlock(result, 'if', (key, body) => {
      let value = resolvePath(key, variables);

      // Split on {{else}} if present
      let elseParts = body.split('{{else}}');
      let trueBranch = elseParts[0];
      let falseBranch =
        elseParts.length > 1 ? elseParts.slice(1).join('{{else}}') : '';

      if (isTruthy(value)) {
        return processBlock(trueBranch, variables);
      }
      return processBlock(falseBranch, variables);
    });
  } while (result !== prevResult);

  return result;
}

function processEachBlocks(
  template: string,
  variables: Record<string, unknown>,
): string {
  let result = template;
  let prevResult: string;

  do {
    prevResult = result;
    result = replaceOutermostBlock(result, 'each', (key, body) => {
      let arr = resolvePath(key, variables);
      if (!Array.isArray(arr) || arr.length === 0) {
        return '';
      }

      return arr
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            // Object item — merge into variables for nested resolution
            let itemVars = { ...variables, ...item };
            return processBlock(body, itemVars);
          } else {
            // Primitive item — replace {{.}} with the value
            let rendered = body.replace(/\{\{\.\}\}/g, String(item));
            return processVariables(rendered, variables);
          }
        })
        .join('');
    });
  } while (result !== prevResult);

  return result;
}

/**
 * Process all block types and variable substitutions in a template body.
 */
function processBlock(
  body: string,
  variables: Record<string, unknown>,
): string {
  let result = processEachBlocks(body, variables);
  result = processIfBlocks(result, variables);
  result = processVariables(result, variables);
  return result;
}

/**
 * Find and replace the first outermost {{#type key}}...{{/type}} block,
 * correctly handling nested blocks of the same type by counting depth.
 */
function replaceOutermostBlock(
  template: string,
  blockType: string,
  handler: (key: string, body: string) => string,
): string {
  let openTag = `{{#${blockType} `;
  let closeTag = `{{/${blockType}}}`;

  let startIdx = template.indexOf(openTag);
  if (startIdx === -1) {
    return template;
  }

  // Find the closing `}}` of the opening tag
  let tagEnd = template.indexOf('}}', startIdx + openTag.length);
  if (tagEnd === -1) {
    return template;
  }
  let key = template.slice(startIdx + openTag.length, tagEnd).trim();
  let bodyStart = tagEnd + 2; // skip `}}`

  // Walk forward to find the matching close tag, tracking nesting depth
  let depth = 1;
  let cursor = bodyStart;
  while (depth > 0 && cursor < template.length) {
    let nextOpen = template.indexOf(openTag, cursor);
    let nextClose = template.indexOf(closeTag, cursor);

    if (nextClose === -1) {
      // No matching close tag found — leave template as-is
      return template;
    }

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Found a nested open tag before the next close tag
      depth++;
      cursor = nextOpen + openTag.length;
    } else {
      // Found a close tag
      depth--;
      if (depth === 0) {
        let body = template.slice(bodyStart, nextClose);
        let replacement = handler(key, body);
        return (
          template.slice(0, startIdx) +
          replacement +
          template.slice(nextClose + closeTag.length)
        );
      }
      cursor = nextClose + closeTag.length;
    }
  }

  return template;
}

function processVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^#/][^}]*)\}\}/g, (_match, key: string) => {
    let trimmed = key.trim();
    if (trimmed === '.') {
      return _match; // {{.}} only resolved inside #each
    }
    let value = resolvePath(trimmed, variables);
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

/**
 * Resolve a dot-separated path against a variables object.
 * "a.b.c" → variables.a.b.c
 */
function resolvePath(
  path: string,
  variables: Record<string, unknown>,
): unknown {
  let parts = path.split('.');
  let current: unknown = variables;

  for (let part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function isTruthy(value: unknown): boolean {
  if (
    value === undefined ||
    value === null ||
    value === false ||
    value === ''
  ) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Message assembly
// ---------------------------------------------------------------------------

export interface AssembleSystemPromptOptions {
  context: AgentContext;
  loader: PromptLoader;
}

export interface AssembleImplementPromptOptions {
  context: AgentContext;
  loader: PromptLoader;
}

export interface AssembleBootstrapPromptOptions {
  context: AgentContext;
  loader: PromptLoader;
}

export interface AssembleIteratePromptOptions {
  context: AgentContext;
  previousActions: AgentAction[];
  iteration: number;
  loader: PromptLoader;
}

export interface AssembleTestPromptOptions {
  context: AgentContext;
  implementedFiles: { path: string; content: string; realm: string }[];
  loader: PromptLoader;
}

/**
 * Build tool results data with outputFormat propagated from tool manifests.
 * Shared between assembleImplementPrompt and assembleIteratePrompt.
 */
function buildToolResultsData(
  context: AgentContext,
): { tool: string; exitCode: number; output: string; outputFormat: string }[] {
  if (!context.toolResults || context.toolResults.length === 0) {
    return [];
  }

  let toolManifestsByName = new Map<string, ToolManifest>();
  for (let tool of context.tools ?? []) {
    toolManifestsByName.set(tool.name, tool);
  }

  return context.toolResults.map((r: ToolResult) => {
    let manifest = toolManifestsByName.get(r.tool);
    let outputFormat = manifest?.outputFormat ?? 'json';

    let output: string;
    if (typeof r.output === 'string') {
      output = r.output;
    } else if (outputFormat === 'text') {
      output = String(r.output);
    } else {
      output = JSON.stringify(r.output, null, 2);
    }

    return {
      tool: r.tool,
      exitCode: r.exitCode,
      output,
      outputFormat,
    };
  });
}

/**
 * Resolve `context.darkfactoryModuleUrl` for prompt rendering, throwing
 * if it's missing or empty.
 *
 * The system prompt interpolates this value as the `meta.adoptsFrom.module`
 * the agent should set on every Project / Issue / KnowledgeArticle JSON
 * file it writes. Letting an empty string flow through would silently
 * produce malformed tracker cards. In production this is always set by
 * `factory-issue-loop-wiring.ts` (via `inferDarkfactoryModuleUrl`); a
 * missing value indicates a plumbing bug, so fail fast.
 */
export function requireDarkfactoryModuleUrl(context: AgentContext): string {
  let url = context.darkfactoryModuleUrl;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error(
      'AgentContext.darkfactoryModuleUrl is required for system prompt rendering ' +
        '(it becomes `meta.adoptsFrom.module` on every tracker-schema card the agent writes). ' +
        'This is normally set by factory-issue-loop-wiring via inferDarkfactoryModuleUrl(targetRealm).',
    );
  }
  return url;
}

/**
 * Assemble the system prompt for a one-shot LLM call.
 * This is the same for all calls within an issue.
 *
 * Uses the tool-use system prompt template (prompts/system.md). Tools are
 * provided natively via the LLM API's tool definitions parameter, not
 * embedded in the prompt text.
 */
export function assembleSystemPrompt(
  options: AssembleSystemPromptOptions,
): string {
  let { context, loader } = options;

  let skills = context.skills.map((s: ResolvedSkill) => ({
    name: s.name,
    content: s.content,
    references: s.references ?? [],
  }));

  return loader.load('system', {
    targetRealm: context.targetRealm,
    darkfactoryModuleUrl: requireDarkfactoryModuleUrl(context),
    skills,
  });
}

/**
 * Assemble the user prompt for the initial implementation pass.
 * Includes tool results when present (e.g., after invoke_tool actions
 * from a prior plan() call that returned tool invocations before implementation).
 */
/**
 * Issue types that FIX broken behavior on a card that already shipped
 * (as opposed to building a new one). These skip the design round — no
 * mockups, no critique — and use the diagnose-and-fix prompt. Defects filed
 * by the acceptance walkthrough carry `defect`; the rest are defensive
 * synonyms a bootstrap agent might emit.
 */
const BUG_FIX_ISSUE_TYPES = new Set([
  'defect',
  'bug',
  'regression',
  'hotfix',
  'fix',
]);

/** True for a bug-fix issue — see BUG_FIX_ISSUE_TYPES. */
export function isBugFixIssue(
  issue: { issueType?: string } | undefined,
): boolean {
  let t = issue?.issueType;
  return typeof t === 'string' && BUG_FIX_ISSUE_TYPES.has(t.toLowerCase());
}

export function assembleImplementPrompt(
  options: AssembleImplementPromptOptions,
): string {
  let { context, loader } = options;

  let toolResultsData = buildToolResultsData(context);

  // Prompt selection. Bug-fix issues take a diagnose-and-fix prompt with no
  // design round (the card already shipped; only its behavior is broken).
  // Otherwise, phase-split (v2) gives the design and build turns dedicated
  // prompts; an unsplit v2 turn keeps the combined design-first prompt.
  let template =
    context.v2 === true
      ? isBugFixIssue(context.issue as { issueType?: string })
        ? 'issue-fix-v2'
        : context.phase === 'design'
          ? 'issue-design-v2'
          : context.phase === 'build'
            ? 'issue-build-v2'
            : 'issue-implement-v2'
      : 'issue-implement';
  return loader.load(template, {
    project: context.project,
    issue: context.issue,
    knowledge: context.knowledge,
    toolResults: toolResultsData.length > 0 ? toolResultsData : undefined,
  });
}

/**
 * Assemble the user prompt for a bootstrap issue.
 * Includes brief URL and issue description so the agent knows what
 * project artifacts to create.
 */
export function assembleBootstrapPrompt(
  options: AssembleBootstrapPromptOptions,
): string {
  let { context, loader } = options;

  // v2's bootstrap variant strips the QUnit/test requirements — the v2
  // pipeline runs no tests, and baking them into issue descriptions made
  // agents write .test.gts despite the skill's no-tests hard rule.
  return loader.load(
    context.v2 === true ? 'bootstrap-implement-v2' : 'bootstrap-implement',
    {
      briefUrl: context.briefUrl,
      issue: context.issue,
    },
  );
}

/**
 * Assemble the user prompt for a test generation pass.
 */
export function assembleTestPrompt(options: AssembleTestPromptOptions): string {
  let { context, implementedFiles, loader } = options;

  return loader.load('issue-test', {
    issue: context.issue,
    implementedFiles,
  });
}

/**
 * Assemble the user prompt for a test-iterate (fix) pass.
 */
export function assembleIteratePrompt(
  options: AssembleIteratePromptOptions,
): string {
  let { context, previousActions, iteration, loader } = options;

  let previousActionsData = previousActions.map((a: AgentAction) => ({
    type: a.type,
    path: a.path ?? '(none)',
    content: a.content ?? '',
    realm: a.realm ?? '(none)',
  }));

  let toolResultsData = buildToolResultsData(context);

  return loader.load('issue-iterate', {
    project: context.project,
    issue: context.issue,
    iteration,
    previousActions: previousActionsData,
    validationContext: context.validationContext,
    toolResults: toolResultsData.length > 0 ? toolResultsData : undefined,
  });
}

/**
 * Build the complete [system, user] message pair for a one-shot LLM call.
 */
export function buildOneShotMessages(
  systemPrompt: string,
  userPrompt: string,
): [ChatMessage, ChatMessage] {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PromptTemplateNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptTemplateNotFoundError';
  }
}
