import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import type {
  AgentAction,
  AgentContext,
  ChatMessage,
  ResolvedSkill,
  TestFailure,
  ToolManifest,
  ToolResult,
} from './factory-agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMPTS_DIR = resolve(__dirname, '../../prompts');

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
 * Assemble the system prompt for a one-shot LLM call.
 * This is the same for all calls within a ticket.
 */
export function assembleSystemPrompt(
  options: AssembleSystemPromptOptions,
): string {
  let { context, loader } = options;
  let actionSchema = loader.load('action-schema', {});

  let skills = context.skills.map((s: ResolvedSkill) => ({
    name: s.name,
    content: s.content,
    references: s.references ?? [],
  }));

  let tools = context.tools.map((t: ToolManifest) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    outputFormat: t.outputFormat,
    args: t.args.map((a) => ({
      name: a.name,
      type: a.type,
      required: a.required,
      description: a.description,
    })),
  }));

  return loader.load('system', {
    actionSchema,
    targetRealmUrl: context.targetRealmUrl,
    testRealmUrl: context.testRealmUrl,
    skills,
    tools,
  });
}

/**
 * Assemble the user prompt for the initial implementation pass.
 */
export function assembleImplementPrompt(
  options: AssembleImplementPromptOptions,
): string {
  let { context, loader } = options;

  return loader.load('ticket-implement', {
    project: context.project,
    ticket: context.ticket,
    knowledge: context.knowledge,
  });
}

/**
 * Assemble the user prompt for a test generation pass.
 */
export function assembleTestPrompt(options: AssembleTestPromptOptions): string {
  let { context, implementedFiles, loader } = options;

  return loader.load('ticket-test', {
    ticket: context.ticket,
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

  let testFailures = (context.testResults?.failures ?? []).map(
    (f: TestFailure) => ({
      testName: f.testName,
      error: f.error,
      stackTrace: f.stackTrace,
    }),
  );

  let toolResultsData = (context.toolResults ?? []).map((r: ToolResult) => ({
    tool: r.tool,
    exitCode: r.exitCode,
    output:
      typeof r.output === 'string'
        ? r.output
        : JSON.stringify(r.output, null, 2),
  }));

  return loader.load('ticket-iterate', {
    project: context.project,
    ticket: context.ticket,
    iteration,
    previousActions: previousActionsData,
    testResults: context.testResults
      ? {
          status: context.testResults.status,
          passedCount: context.testResults.passedCount,
          failedCount: context.testResults.failedCount,
          durationMs: context.testResults.durationMs,
          failures: testFailures,
        }
      : undefined,
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
