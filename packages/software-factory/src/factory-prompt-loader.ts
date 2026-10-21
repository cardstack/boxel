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
 * - {{#each items}} ... {{else}} ... {{/each}} — iterate over arrays; the
 *   optional {{else}} branch renders when the array is missing or empty
 * - {{#if value}} ... {{else}} ... {{/if}} — conditional blocks
 * - {{.}} — current item in an #each block over an array of non-objects
 *
 * The template is parsed once and rendered in a single walk, so a substituted
 * value is never parsed as template syntax. Runs of three or more newlines in
 * the template text collapse to two and the output's edges are trimmed;
 * substituted values are emitted exactly as given. A tag that doesn't form a
 * block (an unclosed opener, a stray closer or {{else}}) renders as written.
 */
export function interpolate(
  template: string,
  variables: Record<string, unknown>,
): string {
  let segments: Segment[] = [];
  renderNodes(parseTemplate(template), { variables }, segments);
  return joinSegments(segments);
}

type TemplateNode = TextNode | ValueNode | BlockNode;

interface TextNode {
  kind: 'text';
  text: string;
}

interface ValueNode {
  kind: 'value';
  path: string;
  source: string;
}

interface BlockNode {
  kind: 'block';
  type: 'each' | 'if';
  path: string;
  body: TemplateNode[];
  inverse: TemplateNode[];
}

interface Segment {
  text: string;
  isValue: boolean;
}

interface Scope {
  variables: Record<string, unknown>;
  // The current item of an #each over non-objects, which {{.}} refers to
  item?: { value: unknown };
}

const TAG = /\{\{(#(each|if)\s+([^}]*)|\/(each|if)|else|[^#/}][^}]*)\}\}/g;

function parseTemplate(template: string): TemplateNode[] {
  let root: TemplateNode[] = [];
  let open: { node: BlockNode; source: string; inElse: boolean }[] = [];
  let children = (): TemplateNode[] => {
    let top = open[open.length - 1];
    return !top ? root : top.inElse ? top.node.inverse : top.node.body;
  };
  let pushText = (text: string) => {
    if (text) {
      children().push({ kind: 'text', text });
    }
  };

  let cursor = 0;
  for (let match of template.matchAll(TAG)) {
    pushText(template.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    let [source, inner, openType, key, closeType] = match;
    let top = open[open.length - 1];
    if (openType) {
      let node: BlockNode = {
        kind: 'block',
        type: openType as BlockNode['type'],
        path: key.trim(),
        body: [],
        inverse: [],
      };
      children().push(node);
      open.push({ node, source, inElse: false });
    } else if (closeType) {
      if (top?.node.type === closeType) {
        open.pop();
      } else {
        pushText(source);
      }
    } else if (inner === 'else') {
      if (top && !top.inElse) {
        top.inElse = true;
      } else {
        pushText(source);
      }
    } else {
      children().push({ kind: 'value', path: inner.trim(), source });
    }
  }
  pushText(template.slice(cursor));

  // An opener with no closer renders as written, followed by what it held
  while (open.length > 0) {
    let { node, source, inElse } = open.pop()!;
    let siblings = children();
    siblings.pop();
    siblings.push({ kind: 'text', text: source }, ...node.body);
    if (inElse) {
      siblings.push({ kind: 'text', text: '{{else}}' }, ...node.inverse);
    }
  }

  return root;
}

function renderNodes(nodes: TemplateNode[], scope: Scope, out: Segment[]) {
  for (let node of nodes) {
    if (node.kind === 'text') {
      out.push({ text: node.text, isValue: false });
    } else if (node.kind === 'value') {
      renderValue(node, scope, out);
    } else if (node.type === 'each') {
      renderEach(node, scope, out);
    } else {
      let branch = isTruthy(lookup(node.path, scope))
        ? node.body
        : node.inverse;
      renderNodes(branch, scope, out);
    }
  }
}

function renderValue(node: ValueNode, scope: Scope, out: Segment[]) {
  if (node.path === '.' && !scope.item) {
    // {{.}} only means something inside an #each over non-objects
    out.push({ text: node.source, isValue: false });
    return;
  }
  let value = lookup(node.path, scope);
  let text =
    value === undefined || value === null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (text) {
    out.push({ text, isValue: true });
  }
}

function renderEach(node: BlockNode, scope: Scope, out: Segment[]) {
  let items = lookup(node.path, scope);
  if (!Array.isArray(items) || items.length === 0) {
    renderNodes(node.inverse, scope, out);
    return;
  }
  for (let item of items) {
    let itemScope: Scope =
      typeof item === 'object' && item !== null
        ? // Object item — merge into variables for nested resolution
          { variables: { ...scope.variables, ...item } }
        : { variables: scope.variables, item: { value: item } };
    renderNodes(node.body, itemScope, out);
  }
}

function lookup(path: string, scope: Scope): unknown {
  return path === '.' ? scope.item?.value : resolvePath(path, scope.variables);
}

/**
 * Join rendered segments, collapsing runs of three or more newlines in the
 * template text to two and trimming whitespace from the output's edges. A
 * value ends any newline run and is never collapsed or trimmed itself.
 */
function joinSegments(segments: Segment[]): string {
  let parts: Segment[] = [];
  let newlines = 0;
  for (let segment of segments) {
    if (segment.isValue) {
      parts.push(segment);
      newlines = 0;
      continue;
    }
    let text = '';
    for (let char of segment.text) {
      if (char !== '\n') {
        newlines = 0;
      } else if (++newlines > 2) {
        continue;
      }
      text += char;
    }
    parts.push({ text, isValue: false });
  }

  while (parts.length > 0 && !parts[0].isValue) {
    let text = parts[0].text.trimStart();
    if (text) {
      parts[0] = { text, isValue: false };
      break;
    }
    parts.shift();
  }
  while (parts.length > 0 && !parts[parts.length - 1].isValue) {
    let text = parts[parts.length - 1].text.trimEnd();
    if (text) {
      parts[parts.length - 1] = { text, isValue: false };
      break;
    }
    parts.pop();
  }

  return parts.map((part) => part.text).join('');
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
  // Otherwise, phase-split gives the design and build turns dedicated
  // prompts; an unsplit turn keeps the combined design-first prompt.
  let template = isBugFixIssue(context.issue as { issueType?: string })
    ? 'issue-fix'
    : context.phase === 'design'
      ? 'issue-design'
      : context.phase === 'build'
        ? 'issue-build'
        : 'issue-implement';
  return loader.load(template, {
    project: context.project,
    issue: context.issue,
    knowledge: context.knowledge,
    toolResults: toolResultsData.length > 0 ? toolResultsData : undefined,
    // The turn prompts gate their reuse steps on this. Without it the flag is
    // system-prompt-only: a `--no-catalog-reuse` run is told the catalog is
    // off limits and then told it MUST produce a table of catalog modules.
    enableCatalogReuse: context.enableCatalogReuse !== false,
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

  // The bootstrap prompt strips the QUnit/test requirements — the per-issue
  // pipeline runs no tests, and baking them into issue descriptions made
  // agents write .test.gts despite the skill's no-tests hard rule.
  return loader.load('bootstrap-implement', {
    briefUrl: context.briefUrl,
    issue: context.issue,
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
