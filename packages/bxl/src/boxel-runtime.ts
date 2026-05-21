import {
  DEFAULT_BUILTIN_LIBRARIES,
  type BuiltinLibraryName,
} from './bxl/registry/index.js';
import type {
  ReadableField,
  ReadableSchema,
  ReadableSyntaxWarning,
} from './bxl/compiler/readable-syntax.js';
import { prepareNativeJq } from './bxl/bridge/native.js';
import { resolveLazyBuiltinLibrariesForExpressions } from './bxl/bridge/lazy-formulas.js';
import type { NativeRuntimeLimits } from './jqtools/evaluate/runtimeState.js';
import { getPath } from './jqtools/evaluate/utils/getPath.js';
import { setPath } from './jqtools/evaluate/utils/setPath.js';
import type { Path } from './jqtools/evaluate/utils/utils.js';
import { toBxlErrorRecord, type BxlSafeResult } from './error-utils.js';

export interface BoxelExpressionValue {
  expression: string;
}

export type BoxelGuideExpression = string | BoxelExpressionValue;
export type BoxelLiteralOrExpression<T> = T | BoxelExpressionValue;

export interface BoxelConstraintSpec {
  id?: string;
  fieldPath?: string;
  expression: BoxelGuideExpression;
  message?: string;
  severity?: string;
}

export interface BoxelFieldGuideSpec {
  fieldPath: string;
  label?: string;
  altLabel?: string;
  helperText?: string;
  placeholder?: string;
  required?: boolean | BoxelExpressionValue;
  min?: number;
  max?: number;
  pattern?: string;
  visibleWhen?: BoxelGuideExpression;
  suggestedValue?: BoxelGuideExpression;
  suggestedLabel?: string;
  defaultFrom?: BoxelGuideExpression;
  computedVia?: BoxelGuideExpression;
  note?: string;
  noteAuthor?: string;
  constraints?: BoxelConstraintSpec[];
}

export interface BoxelGuideSpec {
  target?: string;
  fieldGuides: BoxelFieldGuideSpec[];
  constraints?: BoxelConstraintSpec[];
}

export interface BoxelFormulaSpec {
  id?: string;
  targetPath: string;
  expression: BoxelGuideExpression;
  label?: string;
}

export type BoxelAnnotationKind =
  | 'comment'
  | 'edit'
  | 'suggestion'
  | 'question'
  | 'working-on'
  | 'reviewing'
  | (string & {});

export interface BoxelAnnotationActor {
  kind?: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
}

export interface BoxelAnnotationSpec {
  id?: string;
  targetPath?: string;
  targetCardId?: string;
  targetCardType?: string;
  cardTitle?: BoxelLiteralOrExpression<string>;
  kind: BoxelAnnotationKind;
  when?: BoxelGuideExpression;
  summary?: BoxelLiteralOrExpression<string>;
  details?: BoxelLiteralOrExpression<string>;
  snippet?: BoxelLiteralOrExpression<string>;
  previousValue?: BoxelLiteralOrExpression<string>;
  newValue?: BoxelLiteralOrExpression<string>;
  createdAt?: BoxelLiteralOrExpression<string>;
  actor?: BoxelAnnotationActor;
}

export interface BoxelRuntimeDefinition {
  schema?: ReadableSchema;
  guide?: BoxelGuideSpec;
  formulas?: BoxelFormulaSpec[];
  annotations?: BoxelAnnotationSpec[];
}

export interface BoxelRuntimeOptions {
  schema?: ReadableSchema;
  libraries?: BuiltinLibraryName[];
  readableSyntax?: boolean;
  runtimeLimits?: NativeRuntimeLimits;
  now?: () => string;
}

export interface BoxelRuntimeWarning {
  ruleId: string;
  expression: string;
  warnings: ReadableSyntaxWarning[];
}

export interface BoxelRuntimeRuleSummary {
  id: string;
  kind:
    | 'formula'
    | 'constraint'
    | 'field-visible'
    | 'field-required'
    | 'field-suggested'
    | 'annotation';
  expression?: string;
  fieldPath?: string;
  targetPath?: string;
  deps: string[];
  emits: string[];
}

export interface BoxelGuideViolation {
  ruleId: string;
  fieldPath: string;
  expression: string;
  message: string;
  severity: string;
  error?: string;
}

export interface BoxelFieldSuggestion {
  value: unknown;
  label: string | null;
}

export interface BoxelFieldState {
  path: string;
  label: string;
  altLabel: string | null;
  helperText: string | null;
  placeholder: string | null;
  required: boolean;
  visible: boolean;
  min: number | null;
  max: number | null;
  pattern: string | null;
  suggested: BoxelFieldSuggestion | null;
  note: { text: string; author: string | null } | null;
  errors: BoxelGuideViolation[];
}

export interface BoxelFormulaPatch {
  ruleId: string;
  path: string;
  value: unknown;
}

export interface BoxelAnnotationEntryDraft {
  ruleId: string;
  targetPath: string;
  kind: BoxelAnnotationKind;
  summary?: string;
  details?: string;
  snippet?: string;
  previousValue?: string;
  newValue?: string;
  createdAt?: string;
  actor?: BoxelAnnotationActor;
}

export interface BoxelAnnotationCardDraft {
  targetCardId?: string;
  targetCardType?: string;
  cardTitle?: string;
  entries: BoxelAnnotationEntryDraft[];
}

export interface BoxelRuntimeErrorRecord {
  ruleId: string;
  kind: BoxelRuntimeRuleSummary['kind'];
  expression?: string;
  fieldPath?: string;
  targetPath?: string;
  message: string;
}

export interface BoxelRuntimeDelta {
  changedRoots: string[];
  evaluatedRuleIds: string[];
  evaluatedFormulaPatches: BoxelFormulaPatch[];
}

export interface BoxelRuntimeResult {
  source: unknown;
  state: unknown;
  fieldState: Record<string, BoxelFieldState>;
  fieldStateList: BoxelFieldState[];
  violations: BoxelGuideViolation[];
  formulaPatches: BoxelFormulaPatch[];
  annotationCards: BoxelAnnotationCardDraft[];
  runtimeErrors: BoxelRuntimeErrorRecord[];
  delta: BoxelRuntimeDelta;
}

export interface BoxelRuntimeSession {
  readonly source: unknown;
  readonly state: unknown;
  readonly result: BoxelRuntimeResult | null;
  evaluate(): BoxelRuntimeResult;
  replace(input: unknown): BoxelRuntimeResult;
  applyPatch(path: string, value: unknown): BoxelRuntimeResult;
}

export interface PreparedBoxelRuntime {
  schema: ReadableSchema;
  warnings: BoxelRuntimeWarning[];
  rules: BoxelRuntimeRuleSummary[];
  evaluate(input: unknown): BoxelRuntimeResult;
  createSession(initialInput: unknown): BoxelRuntimeSession;
}

export interface BoxelRuntimeAsyncOptions
  extends Omit<BoxelRuntimeOptions, 'now'> {
  cacheKey?: string;
  guideUrl?: string;
  contentHash?: string;
  worker?: boolean;
}

export interface BoxelRuntimeAsyncSession {
  readonly source: unknown;
  readonly state: unknown;
  readonly result: BoxelRuntimeResult | null;
  readonly ready: Promise<void>;
  evaluate(): Promise<BoxelRuntimeResult>;
  replace(input: unknown): Promise<BoxelRuntimeResult>;
  applyPatch(path: string, value: unknown): Promise<BoxelRuntimeResult>;
  swapPlan(prepared: PreparedBoxelRuntimeAsync): Promise<BoxelRuntimeResult>;
  dispose(): Promise<void>;
}

export interface PreparedBoxelRuntimeAsync {
  cacheKey: string;
  cacheNamespace: string;
  contentHash: string;
  guideUrl?: string;
  schema: ReadableSchema;
  warnings: BoxelRuntimeWarning[];
  rules: BoxelRuntimeRuleSummary[];
  evaluate(input: unknown): Promise<BoxelRuntimeResult>;
  createSession(initialInput: unknown): BoxelRuntimeAsyncSession;
}

interface PreparedExpression {
  expression: string;
  deps: string[];
  warnings: ReadableSyntaxWarning[];
  evaluate(input: unknown): unknown;
}

interface PreparedFormulaRule {
  id: string;
  kind: 'formula';
  targetPath: string;
  emittedRoots: string[];
  deps: string[];
  prepared: PreparedExpression;
}

interface PreparedConstraintRule {
  id: string;
  kind: 'constraint';
  fieldPath: string;
  deps: string[];
  message?: string;
  severity?: string;
  prepared: PreparedExpression;
}

interface PreparedFieldDynamicRule {
  id: string;
  kind: 'field-visible' | 'field-required' | 'field-suggested';
  fieldPath: string;
  deps: string[];
  fallback: boolean;
  suggestedLabel?: string;
  prepared: PreparedExpression;
}

interface PreparedAnnotationRule {
  id: string;
  kind: 'annotation';
  targetPath: string;
  targetCardId?: string;
  targetCardType?: string;
  cardTitle?: string;
  cardTitleExpression?: PreparedExpression;
  annotationKind: BoxelAnnotationKind;
  actor?: BoxelAnnotationActor;
  deps: string[];
  when?: PreparedExpression;
  summary?: string;
  summaryExpression?: PreparedExpression;
  details?: string;
  detailsExpression?: PreparedExpression;
  snippet?: string;
  snippetExpression?: PreparedExpression;
  previousValue?: string;
  previousValueExpression?: PreparedExpression;
  newValue?: string;
  newValueExpression?: PreparedExpression;
  createdAt?: string;
  createdAtExpression?: PreparedExpression;
}

type AnyPreparedRule =
  | PreparedFormulaRule
  | PreparedConstraintRule
  | PreparedFieldDynamicRule
  | PreparedAnnotationRule;

interface FieldGuideStaticState {
  path: string;
  label: string;
  altLabel: string | null;
  helperText: string | null;
  placeholder: string | null;
  required: boolean;
  min: number | null;
  max: number | null;
  pattern: string | null;
  note: { text: string; author: string | null } | null;
}

interface FormulaRuleOutput {
  patch: BoxelFormulaPatch;
  error?: BoxelRuntimeErrorRecord;
}

interface ConstraintRuleOutput {
  violation: BoxelGuideViolation | null;
  error?: BoxelRuntimeErrorRecord;
}

interface FieldRuleOutput {
  value: boolean | BoxelFieldSuggestion | null;
  error?: BoxelRuntimeErrorRecord;
}

interface AnnotationRuleOutput {
  entry: BoxelAnnotationEntryDraft | null;
  targetCardId?: string;
  targetCardType?: string;
  cardTitle?: string;
  error?: BoxelRuntimeErrorRecord;
}

interface PreparedRuntimeInternals {
  schema: ReadableSchema;
  warnings: BoxelRuntimeWarning[];
  rules: AnyPreparedRule[];
  rulesById: Map<string, AnyPreparedRule>;
  reverseDeps: Map<string, string[]>;
  formulaOrder: string[];
  fieldStatics: Map<string, FieldGuideStaticState>;
  fieldOrder: string[];
  formulaRuleIds: Set<string>;
}

function normalizeOutputs(outputs: unknown[]): unknown {
  if (outputs.length === 0) return null;
  if (outputs.length === 1) return outputs[0];
  return outputs;
}

function normalizeExpressionSlot(value: BoxelGuideExpression): string {
  return typeof value === 'string' ? value : value.expression;
}

function isExpressionValue(value: unknown): value is BoxelExpressionValue {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'expression' in value &&
      typeof (value as { expression: unknown }).expression === 'string',
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePath(path: string | undefined): string {
  if (!path || path === '.') {
    return '.';
  }
  return path.startsWith('.') ? path : `.${path}`;
}

function parsePath(path: string): Path {
  const normalized = normalizePath(path);
  if (normalized === '.') {
    return [];
  }

  const out: Path = [];
  let index = normalized.startsWith('.') ? 1 : 0;

  while (index < normalized.length) {
    if (normalized[index] === '.') {
      index++;
      continue;
    }

    if (normalized[index] === '[') {
      const close = normalized.indexOf(']', index);
      if (close === -1) {
        throw new Error(`Invalid path "${path}": missing closing ]`);
      }
      const raw = normalized.slice(index + 1, close).trim();
      if (!/^\d+$/.test(raw)) {
        throw new Error(
          `Invalid path "${path}": only numeric indexes are supported`,
        );
      }
      out.push(Number(raw));
      index = close + 1;
      continue;
    }

    const start = index;
    while (
      index < normalized.length &&
      normalized[index] !== '.' &&
      normalized[index] !== '['
    ) {
      index++;
    }
    const key = normalized.slice(start, index);
    if (!key) {
      throw new Error(`Invalid path "${path}"`);
    }
    out.push(key);
  }

  return out;
}

function pathSegments(path: string): Path {
  return parsePath(path);
}

function pathRoot(path: string): string | null {
  for (const segment of pathSegments(path)) {
    if (typeof segment === 'string') {
      return segment;
    }
  }
  return null;
}

function leafKey(path: string): string {
  const segments = pathSegments(path);
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (typeof segment === 'string') {
      return segment;
    }
  }
  return 'value';
}

function cloneField(field: ReadableField): ReadableField {
  return {
    key: field.key,
    label: field.label,
    displayName: field.displayName,
    kind: field.kind,
    fields: field.fields?.map(cloneField),
    item: field.item ? { fields: field.item.fields.map(cloneField) } : undefined,
  };
}

function cloneSchema(schema?: ReadableSchema): ReadableSchema {
  return {
    fields: schema?.fields?.map(cloneField) ?? [],
  };
}

function findField(schema: ReadableSchema, key: string): ReadableField | undefined {
  return schema.fields.find((field) => field.key === key);
}

function ensureFieldForPath(
  schema: ReadableSchema,
  path: string,
  leafLabel?: string,
) {
  const segments = pathSegments(path);
  if (segments.length === 0) {
    return;
  }

  let scope = schema;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (typeof segment !== 'string') {
      continue;
    }

    const next = segments[index + 1];
    const desiredKind =
      next === undefined ? 'scalar' : typeof next === 'number' ? 'array' : 'object';
    let field = findField(scope, segment);

    if (!field) {
      field = {
        key: segment,
        label:
          index === segments.length - 1 && leafLabel ? leafLabel : humanizeKey(segment),
      };
      if (desiredKind === 'object') {
        field.kind = 'object';
        field.fields = [];
      } else if (desiredKind === 'array') {
        field.kind = 'array';
        field.item = { fields: [] };
      }
      scope.fields.push(field);
    } else if (!field.label && index === segments.length - 1 && leafLabel) {
      field.label = leafLabel;
    }

    if (desiredKind === 'object') {
      if (field.kind === undefined || field.kind === 'scalar') {
        field.kind = 'object';
        field.fields = field.fields ?? [];
      }
      if (field.kind !== 'object') {
        throw new Error(
          `Schema path conflict at "${segment}" while augmenting "${path}"`,
        );
      }
      field.fields = field.fields ?? [];
      scope = { fields: field.fields };
      continue;
    }

    if (desiredKind === 'array') {
      if (field.kind === undefined || field.kind === 'scalar') {
        field.kind = 'array';
        field.item = field.item ?? { fields: [] };
      }
      if (field.kind !== 'array') {
        throw new Error(
          `Schema path conflict at "${segment}" while augmenting "${path}"`,
        );
      }
      field.item = field.item ?? { fields: [] };
      scope = field.item;
    }
  }
}

function prepareExpression(
  expression: string,
  schema: ReadableSchema,
  options: BoxelRuntimeOptions,
): PreparedExpression {
  const prepared = prepareNativeJq(expression, {
    schema,
    readableSyntax: options.readableSyntax,
    libraries: options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
    runtimeLimits: options.runtimeLimits,
  });

  return {
    expression,
    deps: [...prepared.deps],
    warnings: prepared.readableWarnings,
    evaluate(input: unknown) {
      const run = prepared.run(input, {
        runtimeLimits: options.runtimeLimits,
      });
      return normalizeOutputs(run.outputs);
    },
  };
}

function createRuleId(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(4, '0')}`;
}

function createErrorRecord(
  rule: AnyPreparedRule,
  message: string,
): BoxelRuntimeErrorRecord {
  return {
    ruleId: rule.id,
    kind: rule.kind,
    expression: 'prepared' in rule ? rule.prepared.expression : undefined,
    fieldPath: 'fieldPath' in rule ? rule.fieldPath : undefined,
    targetPath: 'targetPath' in rule ? rule.targetPath : undefined,
    message,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function coerceString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : String(value);
}

function collectRuntimeExpressions(definition: BoxelRuntimeDefinition): string[] {
  const expressions: string[] = [];
  const add = (value: BoxelGuideExpression | undefined) => {
    if (value) {
      expressions.push(normalizeExpressionSlot(value));
    }
  };
  const addLiteralOrExpression = (
    value: BoxelLiteralOrExpression<string> | undefined,
  ) => {
    if (isExpressionValue(value)) {
      expressions.push(value.expression);
    }
  };

  for (const fieldGuide of definition.guide?.fieldGuides ?? []) {
    add(fieldGuide.visibleWhen);
    add(fieldGuide.suggestedValue);
    add(fieldGuide.defaultFrom);
    add(fieldGuide.computedVia);
    if (isExpressionValue(fieldGuide.required)) {
      expressions.push(fieldGuide.required.expression);
    }
    for (const constraint of fieldGuide.constraints ?? []) {
      add(constraint.expression);
    }
  }

  for (const constraint of definition.guide?.constraints ?? []) {
    add(constraint.expression);
  }
  for (const formula of definition.formulas ?? []) {
    add(formula.expression);
  }
  for (const annotation of definition.annotations ?? []) {
    add(annotation.when);
    addLiteralOrExpression(annotation.cardTitle);
    addLiteralOrExpression(annotation.summary);
    addLiteralOrExpression(annotation.details);
    addLiteralOrExpression(annotation.snippet);
    addLiteralOrExpression(annotation.previousValue);
    addLiteralOrExpression(annotation.newValue);
    addLiteralOrExpression(annotation.createdAt);
  }

  return expressions;
}

async function resolveLazyBoxelRuntimeOptions(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeOptions,
): Promise<BoxelRuntimeOptions> {
  const libraries = await resolveLazyBuiltinLibrariesForExpressions(
    collectRuntimeExpressions(definition),
    options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
  );
  return { ...options, libraries };
}

function resolveLiteralOrExpression(
  value: BoxelLiteralOrExpression<string> | undefined,
  state: unknown,
  prepared: PreparedExpression | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return coerceString(prepared?.evaluate(state));
}

function collectRuleWarnings(rule: AnyPreparedRule): BoxelRuntimeWarning[] {
  const preparedWarnings =
    'prepared' in rule
      ? [{ expression: rule.prepared.expression, warnings: rule.prepared.warnings }]
      : [
          rule.when && {
            expression: rule.when.expression,
            warnings: rule.when.warnings,
          },
          rule.cardTitleExpression && {
            expression: rule.cardTitleExpression.expression,
            warnings: rule.cardTitleExpression.warnings,
          },
          rule.summaryExpression && {
            expression: rule.summaryExpression.expression,
            warnings: rule.summaryExpression.warnings,
          },
          rule.detailsExpression && {
            expression: rule.detailsExpression.expression,
            warnings: rule.detailsExpression.warnings,
          },
          rule.snippetExpression && {
            expression: rule.snippetExpression.expression,
            warnings: rule.snippetExpression.warnings,
          },
          rule.previousValueExpression && {
            expression: rule.previousValueExpression.expression,
            warnings: rule.previousValueExpression.warnings,
          },
          rule.newValueExpression && {
            expression: rule.newValueExpression.expression,
            warnings: rule.newValueExpression.warnings,
          },
          rule.createdAtExpression && {
            expression: rule.createdAtExpression.expression,
            warnings: rule.createdAtExpression.warnings,
          },
        ].filter(Boolean);

  return preparedWarnings.flatMap((entry) =>
    entry && entry.warnings.length > 0
      ? [{ ruleId: rule.id, expression: entry.expression, warnings: entry.warnings }]
      : [],
  );
}

function buildFormulaDependencyOrder(rules: PreparedFormulaRule[]): string[] {
  const emittedByRoot = new Map<string, string[]>();
  for (const rule of rules) {
    for (const root of rule.emittedRoots) {
      const bucket = emittedByRoot.get(root) ?? [];
      bucket.push(rule.id);
      emittedByRoot.set(root, bucket);
    }
  }

  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const rule of rules) {
    indegree.set(rule.id, 0);
    edges.set(rule.id, new Set());
  }

  for (const consumer of rules) {
    for (const dep of consumer.deps) {
      for (const producerId of emittedByRoot.get(dep) ?? []) {
        if (producerId === consumer.id) {
          continue;
        }
        const bucket = edges.get(producerId)!;
        if (!bucket.has(consumer.id)) {
          bucket.add(consumer.id);
          indegree.set(consumer.id, (indegree.get(consumer.id) ?? 0) + 1);
        }
      }
    }
  }

  const queue = rules
    .map((rule) => rule.id)
    .filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift()!;
    order.push(next);
    for (const downstream of edges.get(next) ?? []) {
      const remaining = (indegree.get(downstream) ?? 1) - 1;
      indegree.set(downstream, remaining);
      if (remaining === 0) {
        queue.push(downstream);
      }
    }
  }

  if (order.length !== rules.length) {
    const unresolved = rules
      .map((rule) => rule.id)
      .filter((id) => !order.includes(id));
    throw new Error(
      `Formula dependency cycle detected in Boxel runtime: ${unresolved.join(', ')}`,
    );
  }

  return order;
}

function buildRuleSummary(rule: AnyPreparedRule): BoxelRuntimeRuleSummary {
  return {
    id: rule.id,
    kind: rule.kind,
    expression: 'prepared' in rule ? rule.prepared.expression : undefined,
    fieldPath: 'fieldPath' in rule ? rule.fieldPath : undefined,
    targetPath: 'targetPath' in rule ? rule.targetPath : undefined,
    deps: [...rule.deps],
    emits: 'emittedRoots' in rule ? [...rule.emittedRoots] : [],
  };
}

function isAnnotationRule(rule: AnyPreparedRule): rule is PreparedAnnotationRule {
  return rule.kind === 'annotation';
}

function createReverseDeps(rules: AnyPreparedRule[]): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const rule of rules) {
    for (const dep of rule.deps) {
      const bucket = reverse.get(dep) ?? [];
      bucket.push(rule.id);
      reverse.set(dep, bucket);
    }
  }
  return reverse;
}

function collectAffectedRuleIds(
  runtime: PreparedRuntimeInternals,
  changedRoots: string[],
): string[] {
  const affected = new Set<string>();
  const seenRoots = new Set(changedRoots);
  const queue = [...changedRoots];

  while (queue.length > 0) {
    const root = queue.shift()!;
    for (const ruleId of runtime.reverseDeps.get(root) ?? []) {
      if (affected.has(ruleId)) {
        continue;
      }
      affected.add(ruleId);
      const rule = runtime.rulesById.get(ruleId);
      if (rule?.kind === 'formula') {
        for (const emittedRoot of rule.emittedRoots) {
          if (seenRoots.has(emittedRoot)) {
            continue;
          }
          seenRoots.add(emittedRoot);
          queue.push(emittedRoot);
        }
      }
    }
  }

  return runtime.rules
    .map((rule) => rule.id)
    .filter((ruleId) => affected.has(ruleId));
}

function defaultFieldLabel(path: string): string {
  return humanizeKey(leafKey(path));
}

function prepareBoxelRuntimeInternals(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeOptions = {},
): PreparedRuntimeInternals {
  const baseSchema = cloneSchema(options.schema ?? definition.schema);
  const warnings: BoxelRuntimeWarning[] = [];
  const rules: AnyPreparedRule[] = [];
  const fieldStatics = new Map<string, FieldGuideStaticState>();
  const fieldOrder: string[] = [];
  const formulaTargets = new Set<string>();
  let counter = 0;

  const guide = definition.guide;
  for (const fieldGuide of guide?.fieldGuides ?? []) {
    const path = normalizePath(fieldGuide.fieldPath);
    ensureFieldForPath(baseSchema, path, fieldGuide.label);
    if (fieldGuide.computedVia) {
      if (formulaTargets.has(path)) {
        throw new Error(`Duplicate formula target path ${path}`);
      }
      formulaTargets.add(path);
    }
  }

  for (const formula of definition.formulas ?? []) {
    const targetPath = normalizePath(formula.targetPath);
    if (formulaTargets.has(targetPath)) {
      throw new Error(`Duplicate formula target path ${targetPath}`);
    }
    formulaTargets.add(targetPath);
    ensureFieldForPath(baseSchema, targetPath, formula.label);
  }

  for (const fieldGuide of guide?.fieldGuides ?? []) {
    const path = normalizePath(fieldGuide.fieldPath);
    if (fieldStatics.has(path)) {
      throw new Error(`Duplicate field guide for path ${path}`);
    }
    fieldStatics.set(path, {
      path,
      label: fieldGuide.label ?? defaultFieldLabel(path),
      altLabel: fieldGuide.altLabel ?? null,
      helperText: fieldGuide.helperText ?? null,
      placeholder: fieldGuide.placeholder ?? null,
      required: fieldGuide.required === true,
      min: fieldGuide.min ?? null,
      max: fieldGuide.max ?? null,
      pattern: fieldGuide.pattern ?? null,
      note: fieldGuide.note
        ? { text: fieldGuide.note, author: fieldGuide.noteAuthor ?? null }
        : null,
    });
    fieldOrder.push(path);
    ensureFieldForPath(baseSchema, path, fieldGuide.label);

    for (const constraint of fieldGuide.constraints ?? []) {
      const id = constraint.id ?? createRuleId('constraint', ++counter);
      const prepared = prepareExpression(
        normalizeExpressionSlot(constraint.expression),
        baseSchema,
        options,
      );
      const rule: PreparedConstraintRule = {
        id,
        kind: 'constraint',
        fieldPath: path,
        deps: prepared.deps,
        message: constraint.message,
        severity: constraint.severity,
        prepared,
      };
      warnings.push(...collectRuleWarnings(rule));
      rules.push(rule);
    }

    if (fieldGuide.visibleWhen) {
      const id = createRuleId('field-visible', ++counter);
      const prepared = prepareExpression(
        normalizeExpressionSlot(fieldGuide.visibleWhen),
        baseSchema,
        options,
      );
      const rule: PreparedFieldDynamicRule = {
        id,
        kind: 'field-visible',
        fieldPath: path,
        deps: prepared.deps,
        fallback: true,
        prepared,
      };
      warnings.push(...collectRuleWarnings(rule));
      rules.push(rule);
    }

    if (isExpressionValue(fieldGuide.required)) {
      const id = createRuleId('field-required', ++counter);
      const prepared = prepareExpression(fieldGuide.required.expression, baseSchema, options);
      const rule: PreparedFieldDynamicRule = {
        id,
        kind: 'field-required',
        fieldPath: path,
        deps: prepared.deps,
        fallback: false,
        prepared,
      };
      warnings.push(...collectRuleWarnings(rule));
      rules.push(rule);
    }

    const suggestedExpr = fieldGuide.defaultFrom ?? fieldGuide.suggestedValue;
    if (suggestedExpr) {
      const id = createRuleId('field-suggested', ++counter);
      const prepared = prepareExpression(
        normalizeExpressionSlot(suggestedExpr),
        baseSchema,
        options,
      );
      const rule: PreparedFieldDynamicRule = {
        id,
        kind: 'field-suggested',
        fieldPath: path,
        deps: prepared.deps,
        fallback: false,
        suggestedLabel: fieldGuide.suggestedLabel,
        prepared,
      };
      warnings.push(...collectRuleWarnings(rule));
      rules.push(rule);
    }
  }

  for (const constraint of guide?.constraints ?? []) {
    const id = constraint.id ?? createRuleId('constraint', ++counter);
    const fieldPath = normalizePath(constraint.fieldPath);
    const prepared = prepareExpression(
      normalizeExpressionSlot(constraint.expression),
      baseSchema,
      options,
    );
    const rule: PreparedConstraintRule = {
      id,
      kind: 'constraint',
      fieldPath,
      deps: prepared.deps,
      message: constraint.message,
      severity: constraint.severity,
      prepared,
    };
    warnings.push(...collectRuleWarnings(rule));
    rules.push(rule);
  }

  for (const fieldGuide of guide?.fieldGuides ?? []) {
    if (!fieldGuide.computedVia) {
      continue;
    }
    const targetPath = normalizePath(fieldGuide.fieldPath);
    const root = pathRoot(targetPath);
    if (!root) {
      throw new Error(`Formula target path ${targetPath} must not be root`);
    }
    const id = createRuleId('formula', ++counter);
    const prepared = prepareExpression(
      normalizeExpressionSlot(fieldGuide.computedVia),
      baseSchema,
      options,
    );
    const rule: PreparedFormulaRule = {
      id,
      kind: 'formula',
      targetPath,
      emittedRoots: [root],
      deps: prepared.deps,
      prepared,
    };
    warnings.push(...collectRuleWarnings(rule));
    rules.push(rule);
  }

  const explicitFormulas = definition.formulas ?? [];
  for (const formula of explicitFormulas) {
    const targetPath = normalizePath(formula.targetPath);
    const root = pathRoot(targetPath);
    if (!root) {
      throw new Error(`Formula target path ${targetPath} must not be root`);
    }
    const id = formula.id ?? createRuleId('formula', ++counter);
    const prepared = prepareExpression(
      normalizeExpressionSlot(formula.expression),
      baseSchema,
      options,
    );
    const rule: PreparedFormulaRule = {
      id,
      kind: 'formula',
      targetPath,
      emittedRoots: [root],
      deps: prepared.deps,
      prepared,
    };
    warnings.push(...collectRuleWarnings(rule));
    rules.push(rule);
  }

  for (const annotation of definition.annotations ?? []) {
    const id = annotation.id ?? createRuleId('annotation', ++counter);
    const deps = new Set<string>();

    const prepareOptional = (value: BoxelLiteralOrExpression<string> | undefined) => {
      if (!isExpressionValue(value)) {
        return undefined;
      }
      const prepared = prepareExpression(value.expression, baseSchema, options);
      for (const dep of prepared.deps) {
        deps.add(dep);
      }
      return prepared;
    };

    const when = annotation.when
      ? prepareExpression(normalizeExpressionSlot(annotation.when), baseSchema, options)
      : undefined;
    for (const dep of when?.deps ?? []) {
      deps.add(dep);
    }

    const cardTitleExpression = prepareOptional(annotation.cardTitle);
    const summaryExpression = prepareOptional(annotation.summary);
    const detailsExpression = prepareOptional(annotation.details);
    const snippetExpression = prepareOptional(annotation.snippet);
    const previousValueExpression = prepareOptional(annotation.previousValue);
    const newValueExpression = prepareOptional(annotation.newValue);
    const createdAtExpression = prepareOptional(annotation.createdAt);

    const rule: PreparedAnnotationRule = {
      id,
      kind: 'annotation',
      targetPath: normalizePath(annotation.targetPath),
      targetCardId: annotation.targetCardId,
      targetCardType: annotation.targetCardType,
      cardTitle:
        typeof annotation.cardTitle === 'string' ? annotation.cardTitle : undefined,
      cardTitleExpression,
      annotationKind: annotation.kind,
      actor: annotation.actor,
      deps: [...deps],
      when,
      summary:
        typeof annotation.summary === 'string' ? annotation.summary : undefined,
      summaryExpression,
      details:
        typeof annotation.details === 'string' ? annotation.details : undefined,
      detailsExpression,
      snippet:
        typeof annotation.snippet === 'string' ? annotation.snippet : undefined,
      snippetExpression,
      previousValue:
        typeof annotation.previousValue === 'string'
          ? annotation.previousValue
          : undefined,
      previousValueExpression,
      newValue:
        typeof annotation.newValue === 'string' ? annotation.newValue : undefined,
      newValueExpression,
      createdAt:
        typeof annotation.createdAt === 'string' ? annotation.createdAt : undefined,
      createdAtExpression,
    };

    warnings.push(...collectRuleWarnings(rule));
    rules.push(rule);
  }

  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const formulaRules = rules.filter(
    (rule): rule is PreparedFormulaRule => rule.kind === 'formula',
  );

  return {
    schema: baseSchema,
    warnings,
    rules,
    rulesById,
    reverseDeps: createReverseDeps(rules),
    formulaOrder: buildFormulaDependencyOrder(formulaRules),
    fieldStatics,
    fieldOrder,
    formulaRuleIds: new Set(formulaRules.map((rule) => rule.id)),
  };
}

function evaluateFormulaRule(
  rule: PreparedFormulaRule,
  state: unknown,
): FormulaRuleOutput {
  try {
    return {
      patch: {
        ruleId: rule.id,
        path: rule.targetPath,
        value: rule.prepared.evaluate(state),
      },
    };
  } catch (error) {
    return {
      patch: {
        ruleId: rule.id,
        path: rule.targetPath,
        value: null,
      },
      error: createErrorRecord(rule, toErrorMessage(error)),
    };
  }
}

function evaluateConstraintRule(
  rule: PreparedConstraintRule,
  state: unknown,
): ConstraintRuleOutput {
  try {
    const passed = Boolean(rule.prepared.evaluate(state));
    return {
      violation: passed
        ? null
        : {
            ruleId: rule.id,
            fieldPath: rule.fieldPath,
            expression: rule.prepared.expression,
            message: rule.message ?? 'Constraint failed',
            severity: rule.severity ?? 'error',
          },
    };
  } catch (error) {
    const message = toErrorMessage(error);
    return {
      violation: {
        ruleId: rule.id,
        fieldPath: rule.fieldPath,
        expression: rule.prepared.expression,
        message: rule.message ?? message,
        severity: rule.severity ?? 'error',
        error: message,
      },
      error: createErrorRecord(rule, message),
    };
  }
}

function evaluateFieldRule(
  rule: PreparedFieldDynamicRule,
  state: unknown,
): FieldRuleOutput {
  try {
    const value = rule.prepared.evaluate(state);
    if (rule.kind === 'field-suggested') {
      return {
        value:
          value === null || value === undefined
            ? null
            : {
                value,
                label: rule.suggestedLabel ?? 'suggested',
              },
      };
    }
    return {
      value: Boolean(value),
    };
  } catch (error) {
    return {
      value: rule.kind === 'field-suggested' ? null : rule.fallback,
      error: createErrorRecord(rule, toErrorMessage(error)),
    };
  }
}

function evaluateAnnotationRule(
  rule: PreparedAnnotationRule,
  state: unknown,
  now: (() => string) | undefined,
): AnnotationRuleOutput {
  try {
    if (rule.when && !Boolean(rule.when.evaluate(state))) {
      return { entry: null };
    }

    const entry: BoxelAnnotationEntryDraft = {
      ruleId: rule.id,
      targetPath: rule.targetPath,
      kind: rule.annotationKind,
      summary: resolveLiteralOrExpression(rule.summary, state, rule.summaryExpression),
      details: resolveLiteralOrExpression(rule.details, state, rule.detailsExpression),
      snippet: resolveLiteralOrExpression(rule.snippet, state, rule.snippetExpression),
      previousValue: resolveLiteralOrExpression(
        rule.previousValue,
        state,
        rule.previousValueExpression,
      ),
      newValue: resolveLiteralOrExpression(
        rule.newValue,
        state,
        rule.newValueExpression,
      ),
      createdAt:
        resolveLiteralOrExpression(
          rule.createdAt,
          state,
          rule.createdAtExpression,
        ) ?? now?.(),
      actor: rule.actor,
    };

    return {
      entry,
      targetCardId: rule.targetCardId,
      targetCardType: rule.targetCardType,
      cardTitle:
        resolveLiteralOrExpression(
          rule.cardTitle,
          state,
          rule.cardTitleExpression,
        ) ?? undefined,
    };
  } catch (error) {
    return {
      entry: null,
      error: createErrorRecord(rule, toErrorMessage(error)),
    };
  }
}

function buildFieldState(
  runtime: PreparedRuntimeInternals,
  fieldOutputs: Map<string, FieldRuleOutput>,
  constraintOutputs: Map<string, ConstraintRuleOutput>,
): {
  fieldState: Record<string, BoxelFieldState>;
  fieldStateList: BoxelFieldState[];
  violations: BoxelGuideViolation[];
} {
  const fieldState = new Map<string, BoxelFieldState>();

  for (const path of runtime.fieldOrder) {
    const base = runtime.fieldStatics.get(path)!;
    fieldState.set(path, {
      path,
      label: base.label,
      altLabel: base.altLabel,
      helperText: base.helperText,
      placeholder: base.placeholder,
      required: base.required,
      visible: true,
      min: base.min,
      max: base.max,
      pattern: base.pattern,
      suggested: null,
      note: base.note,
      errors: [],
    });
  }

  for (const [ruleId, output] of fieldOutputs) {
    const rule = runtime.rulesById.get(ruleId);
    if (!rule || !('fieldPath' in rule)) {
      continue;
    }
    const path = rule.fieldPath;
    const current =
      fieldState.get(path) ??
      {
        path,
        label: defaultFieldLabel(path),
        altLabel: null,
        helperText: null,
        placeholder: null,
        required: false,
        visible: true,
        min: null,
        max: null,
        pattern: null,
        suggested: null,
        note: null,
        errors: [],
      };

    if (rule.kind === 'field-visible') {
      current.visible = Boolean(output.value);
    } else if (rule.kind === 'field-required') {
      current.required = Boolean(output.value);
    } else if (rule.kind === 'field-suggested') {
      current.suggested = output.value as BoxelFieldSuggestion | null;
    }

    fieldState.set(path, current);
  }

  const violations: BoxelGuideViolation[] = [];
  for (const output of constraintOutputs.values()) {
    if (!output.violation) {
      continue;
    }
    violations.push(output.violation);
    const current =
      fieldState.get(output.violation.fieldPath) ??
      {
        path: output.violation.fieldPath,
        label: defaultFieldLabel(output.violation.fieldPath),
        altLabel: null,
        helperText: null,
        placeholder: null,
        required: false,
        visible: true,
        min: null,
        max: null,
        pattern: null,
        suggested: null,
        note: null,
        errors: [],
      };
    current.errors.push(output.violation);
    fieldState.set(output.violation.fieldPath, current);
  }

  const orderedPaths = [
    ...runtime.fieldOrder,
    ...[...fieldState.keys()].filter((path) => !runtime.fieldOrder.includes(path)),
  ];

  return {
    fieldState: Object.fromEntries(
      orderedPaths.map((path) => [path, fieldState.get(path)!]),
    ),
    fieldStateList: orderedPaths.map((path) => fieldState.get(path)!),
    violations,
  };
}

function buildAnnotationCards(
  outputs: Map<string, AnnotationRuleOutput>,
): BoxelAnnotationCardDraft[] {
  const grouped = new Map<string, BoxelAnnotationCardDraft>();

  for (const output of outputs.values()) {
    if (!output.entry) {
      continue;
    }
    const key = [
      output.targetCardId ?? '',
      output.targetCardType ?? '',
      output.cardTitle ?? '',
    ].join('::');
    let card = grouped.get(key);
    if (!card) {
      card = {
        targetCardId: output.targetCardId,
        targetCardType: output.targetCardType,
        entries: [],
        cardTitle: output.cardTitle,
      };
      grouped.set(key, card);
    }
    card.entries.push(output.entry);
  }

  return [...grouped.values()];
}

function buildRuntimeResult(
  runtime: PreparedRuntimeInternals,
  source: unknown,
  state: unknown,
  formulaOutputs: Map<string, FormulaRuleOutput>,
  constraintOutputs: Map<string, ConstraintRuleOutput>,
  fieldOutputs: Map<string, FieldRuleOutput>,
  annotationOutputs: Map<string, AnnotationRuleOutput>,
  evaluatedRuleIds: string[],
  changedRoots: string[],
): BoxelRuntimeResult {
  const { fieldState, fieldStateList, violations } = buildFieldState(
    runtime,
    fieldOutputs,
    constraintOutputs,
  );
  const formulaPatches = runtime.formulaOrder.map(
    (ruleId) => formulaOutputs.get(ruleId)!.patch,
  );
  const evaluatedFormulaPatches = evaluatedRuleIds
    .filter((ruleId) => runtime.formulaRuleIds.has(ruleId))
    .map((ruleId) => formulaOutputs.get(ruleId)!.patch);
  const annotationCards = buildAnnotationCards(annotationOutputs);
  const runtimeErrors = [
    ...formulaOutputs.values(),
    ...constraintOutputs.values(),
    ...fieldOutputs.values(),
    ...annotationOutputs.values(),
  ]
    .map((output) => output.error)
    .filter((error): error is BoxelRuntimeErrorRecord => Boolean(error));

  return {
    source,
    state,
    fieldState,
    fieldStateList,
    violations,
    formulaPatches,
    annotationCards,
    runtimeErrors,
    delta: {
      changedRoots,
      evaluatedRuleIds,
      evaluatedFormulaPatches,
    },
  };
}

export function prepareBoxelRuntime(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeOptions = {},
): PreparedBoxelRuntime {
  const runtime = prepareBoxelRuntimeInternals(definition, options);

  const evaluateInput = (input: unknown): BoxelRuntimeResult => {
    const source = structuredClone(input);
    let state = structuredClone(input);
    const formulaOutputs = new Map<string, FormulaRuleOutput>();
    const constraintOutputs = new Map<string, ConstraintRuleOutput>();
    const fieldOutputs = new Map<string, FieldRuleOutput>();
    const annotationOutputs = new Map<string, AnnotationRuleOutput>();

    for (const ruleId of runtime.formulaOrder) {
      const rule = runtime.rulesById.get(ruleId) as PreparedFormulaRule;
      const output = evaluateFormulaRule(rule, state);
      state = setPath(state, parsePath(rule.targetPath), output.patch.value);
      formulaOutputs.set(rule.id, output);
    }

    for (const rule of runtime.rules) {
      if (rule.kind === 'formula') {
        continue;
      }
      if (rule.kind === 'constraint') {
        constraintOutputs.set(rule.id, evaluateConstraintRule(rule, state));
        continue;
      }
      if (
        rule.kind === 'field-visible' ||
        rule.kind === 'field-required' ||
        rule.kind === 'field-suggested'
      ) {
        fieldOutputs.set(rule.id, evaluateFieldRule(rule, state));
        continue;
      }
      if (isAnnotationRule(rule)) {
        annotationOutputs.set(
          rule.id,
          evaluateAnnotationRule(rule, state, options.now),
        );
      }
    }

    return buildRuntimeResult(
      runtime,
      source,
      state,
      formulaOutputs,
      constraintOutputs,
      fieldOutputs,
      annotationOutputs,
      runtime.rules.map((rule) => rule.id),
      [],
    );
  };

  return {
    schema: runtime.schema,
    warnings: runtime.warnings,
    rules: runtime.rules.map(buildRuleSummary),
    evaluate: evaluateInput,
    createSession(initialInput: unknown): BoxelRuntimeSession {
      let sourceState = structuredClone(initialInput);
      let resolvedState = structuredClone(initialInput);
      let lastResult: BoxelRuntimeResult | null = null;
      const formulaOutputs = new Map<string, FormulaRuleOutput>();
      const constraintOutputs = new Map<string, ConstraintRuleOutput>();
      const fieldOutputs = new Map<string, FieldRuleOutput>();
      const annotationOutputs = new Map<string, AnnotationRuleOutput>();

      const runAll = (): BoxelRuntimeResult => {
        sourceState = structuredClone(sourceState);
        resolvedState = structuredClone(sourceState);
        formulaOutputs.clear();
        constraintOutputs.clear();
        fieldOutputs.clear();
        annotationOutputs.clear();

        for (const ruleId of runtime.formulaOrder) {
          const rule = runtime.rulesById.get(ruleId) as PreparedFormulaRule;
          const output = evaluateFormulaRule(rule, resolvedState);
          resolvedState = setPath(
            resolvedState,
            parsePath(rule.targetPath),
            output.patch.value,
          );
          formulaOutputs.set(rule.id, output);
        }

        for (const rule of runtime.rules) {
          if (rule.kind === 'formula') {
            continue;
          }
          if (rule.kind === 'constraint') {
            constraintOutputs.set(rule.id, evaluateConstraintRule(rule, resolvedState));
            continue;
          }
          if (
            rule.kind === 'field-visible' ||
            rule.kind === 'field-required' ||
            rule.kind === 'field-suggested'
          ) {
            fieldOutputs.set(rule.id, evaluateFieldRule(rule, resolvedState));
            continue;
          }
          if (isAnnotationRule(rule)) {
            annotationOutputs.set(
              rule.id,
              evaluateAnnotationRule(rule, resolvedState, options.now),
            );
          }
        }

        lastResult = buildRuntimeResult(
          runtime,
          sourceState,
          resolvedState,
          formulaOutputs,
          constraintOutputs,
          fieldOutputs,
          annotationOutputs,
          runtime.rules.map((rule) => rule.id),
          [],
        );
        return lastResult;
      };

      const runAffected = (changedRoots: string[]): BoxelRuntimeResult => {
        if (!lastResult) {
          return runAll();
        }

        resolvedState = structuredClone(resolvedState);
        const affectedRuleIds = collectAffectedRuleIds(runtime, changedRoots);

        for (const ruleId of runtime.formulaOrder) {
          if (!affectedRuleIds.includes(ruleId)) {
            continue;
          }
          const rule = runtime.rulesById.get(ruleId) as PreparedFormulaRule;
          const output = evaluateFormulaRule(rule, resolvedState);
          resolvedState = setPath(
            resolvedState,
            parsePath(rule.targetPath),
            output.patch.value,
          );
          formulaOutputs.set(rule.id, output);
        }

        for (const ruleId of affectedRuleIds) {
          if (runtime.formulaRuleIds.has(ruleId)) {
            continue;
          }
          const rule = runtime.rulesById.get(ruleId)!;
          if (rule.kind === 'constraint') {
            constraintOutputs.set(rule.id, evaluateConstraintRule(rule, resolvedState));
            continue;
          }
          if (
            rule.kind === 'field-visible' ||
            rule.kind === 'field-required' ||
            rule.kind === 'field-suggested'
          ) {
            fieldOutputs.set(rule.id, evaluateFieldRule(rule, resolvedState));
            continue;
          }
          if (isAnnotationRule(rule)) {
            annotationOutputs.set(
              rule.id,
              evaluateAnnotationRule(rule, resolvedState, options.now),
            );
          }
        }

        lastResult = buildRuntimeResult(
          runtime,
          sourceState,
          resolvedState,
          formulaOutputs,
          constraintOutputs,
          fieldOutputs,
          annotationOutputs,
          affectedRuleIds,
          changedRoots,
        );
        return lastResult;
      };

      return {
        get source() {
          return sourceState;
        },
        get state() {
          return resolvedState;
        },
        get result() {
          return lastResult;
        },
        evaluate() {
          return runAll();
        },
        replace(input: unknown) {
          sourceState = structuredClone(input);
          resolvedState = structuredClone(input);
          return runAll();
        },
        applyPatch(path: string, value: unknown) {
          const normalizedPath = normalizePath(path);
          const root = pathRoot(normalizedPath);
          sourceState = setPath(sourceState, parsePath(normalizedPath), value);
          resolvedState = setPath(resolvedState, parsePath(normalizedPath), value);
          return runAffected(root ? [root] : []);
        },
      };
    },
  };
}

export function prepareBoxelGuide(
  guide: BoxelGuideSpec,
  options: BoxelRuntimeOptions = {},
): PreparedBoxelRuntime {
  return prepareBoxelRuntime({ guide }, options);
}

export function prepareBoxelRuntimeSafe(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeOptions = {},
): BxlSafeResult<PreparedBoxelRuntime> {
  try {
    return {
      ok: true,
      value: prepareBoxelRuntime(definition, options),
    };
  } catch (error) {
    return {
      ok: false,
      error: toBxlErrorRecord(error, 'prepare'),
    };
  }
}

export function prepareBoxelGuideSafe(
  guide: BoxelGuideSpec,
  options: BoxelRuntimeOptions = {},
): BxlSafeResult<PreparedBoxelRuntime> {
  return prepareBoxelRuntimeSafe({ guide }, options);
}

export function getBoxelValue(input: unknown, path: string): unknown {
  return getPath(input, parsePath(path));
}

const BOXEL_RUNTIME_ASYNC_PROTOCOL = 'boxel-runtime-async:v1';

interface BoxelRuntimeSessionSnapshot {
  source: unknown;
  state: unknown;
  result: BoxelRuntimeResult | null;
}

interface SerializedWorkerError {
  name: string;
  message: string;
  stack?: string;
}

interface PreparedPlanMetadata {
  cacheKey: string;
  cacheNamespace: string;
  contentHash: string;
  guideUrl?: string;
  schema: ReadableSchema;
  warnings: BoxelRuntimeWarning[];
  rules: BoxelRuntimeRuleSummary[];
}

interface PreparePlanPayload {
  cacheKey: string;
  cacheNamespace: string;
  contentHash: string;
  guideUrl?: string;
  definition: BoxelRuntimeDefinition;
  options: BoxelRuntimeOptions;
}

type WorkerRequest =
  | ({ requestId: string; type: 'ensure-plan' } & PreparePlanPayload)
  | ({
      requestId: string;
      type: 'invalidate-plans';
      cacheKey?: string;
      cacheNamespace?: string;
    })
  | ({ requestId: string; type: 'evaluate-plan'; cacheKey: string; input: unknown })
  | ({
      requestId: string;
      type: 'create-session';
      cacheKey: string;
      sessionId: string;
      initialInput: unknown;
    })
  | ({ requestId: string; type: 'session-evaluate'; sessionId: string })
  | ({
      requestId: string;
      type: 'session-replace';
      sessionId: string;
      input: unknown;
    })
  | ({
      requestId: string;
      type: 'session-apply-patch';
      sessionId: string;
      path: string;
      value: unknown;
    })
  | ({
      requestId: string;
      type: 'session-swap-plan';
      sessionId: string;
      cacheKey: string;
    })
  | ({ requestId: string; type: 'session-dispose'; sessionId: string });

type WorkerRequestWithoutId =
  | ({ type: 'ensure-plan' } & PreparePlanPayload)
  | ({ type: 'invalidate-plans'; cacheKey?: string; cacheNamespace?: string })
  | ({ type: 'evaluate-plan'; cacheKey: string; input: unknown })
  | ({
      type: 'create-session';
      cacheKey: string;
      sessionId: string;
      initialInput: unknown;
    })
  | ({ type: 'session-evaluate'; sessionId: string })
  | ({ type: 'session-replace'; sessionId: string; input: unknown })
  | ({
      type: 'session-apply-patch';
      sessionId: string;
      path: string;
      value: unknown;
    })
  | ({ type: 'session-swap-plan'; sessionId: string; cacheKey: string })
  | ({ type: 'session-dispose'; sessionId: string });

type WorkerResponse =
  | { requestId: string; ok: true; value: unknown }
  | { requestId: string; ok: false; error: SerializedWorkerError };

interface MessageEventLike<T> {
  data: T;
}

interface ErrorEventLike {
  error?: unknown;
  message?: string;
}

interface WorkerLike {
  addEventListener(
    type: 'message',
    listener: (event: MessageEventLike<WorkerResponse>) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: ErrorEventLike) => void): void;
  postMessage(message: WorkerRequest): void;
}

interface WorkerConstructorLike {
  new (
    scriptURL: string,
    options?: { name?: string; type?: 'module' | 'classic' },
  ): WorkerLike;
}

interface PreparedPlanIdentity {
  cacheKey: string;
  cacheNamespace: string;
  contentHash: string;
  guideUrl?: string;
}

interface AsyncPreparedRuntimeCacheEntry {
  cacheKey: string;
  cacheNamespace: string;
  promise?: Promise<PreparedBoxelRuntimeAsync>;
  runtimeRef?: WeakRef<PreparedBoxelRuntimeAsync>;
  workerBacked?: boolean;
}

interface WorkerPlanEntry {
  prepared: PreparedBoxelRuntime;
  metadata: PreparedPlanMetadata;
}

const LOCAL_ASYNC_PREPARED_RUNTIME = Symbol('LocalAsyncPreparedRuntime');
const WORKER_ASYNC_PREPARED_RUNTIME = Symbol('WorkerAsyncPreparedRuntime');

interface LocalAsyncPreparedRuntimeHandle extends PreparedBoxelRuntimeAsync {
  [LOCAL_ASYNC_PREPARED_RUNTIME]?: PreparedBoxelRuntime;
}

interface WorkerAsyncPreparedRuntimeHandle extends PreparedBoxelRuntimeAsync {
  [WORKER_ASYNC_PREPARED_RUNTIME]?: {
    manager: BoxelRuntimeWorkerManager;
    metadata: PreparedPlanMetadata;
  };
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  const valueType = typeof value;
  if (
    valueType === 'string' ||
    valueType === 'number' ||
    valueType === 'boolean'
  ) {
    return JSON.stringify(value);
  }

  if (valueType === 'bigint') {
    return JSON.stringify({ $bigint: String(value) });
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify({ $date: value.toISOString() });
  }

  if (valueType === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`,
      );
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(String(value));
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildPreparedContentHash(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeAsyncOptions,
): string {
  return hashString(
    stableSerialize({
      definition,
      compileOptions: {
        schema: options.schema ?? null,
        libraries: options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
        readableSyntax: options.readableSyntax ?? null,
        runtimeLimits: options.runtimeLimits ?? null,
      },
    }),
  );
}

function buildPreparedCacheNamespace(
  options: BoxelRuntimeAsyncOptions,
): string {
  return options.cacheKey ?? options.guideUrl ?? 'inline';
}

function createPreparedPlanIdentity(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeAsyncOptions,
): PreparedPlanIdentity {
  const contentHash =
    options.contentHash ?? buildPreparedContentHash(definition, options);
  const cacheNamespace = buildPreparedCacheNamespace(options);
  const cacheKey = [
    BOXEL_RUNTIME_ASYNC_PROTOCOL,
    cacheNamespace,
    contentHash,
  ].join('::');

  return {
    cacheKey,
    cacheNamespace,
    contentHash,
    guideUrl: options.guideUrl,
  };
}

function createPreparedPlanPayload(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeAsyncOptions,
): PreparePlanPayload {
  const identity = createPreparedPlanIdentity(definition, options);

  return {
    ...identity,
    definition: cloneValue(definition),
    options: {
      schema: cloneValue(options.schema),
      libraries: options.libraries
        ? [...options.libraries]
        : DEFAULT_BUILTIN_LIBRARIES,
      readableSyntax: options.readableSyntax,
      runtimeLimits: cloneValue(options.runtimeLimits),
    },
  };
}

function canUseBrowserWorkerRuntime(
  options: BoxelRuntimeAsyncOptions,
): boolean {
  if (options.worker === false) {
    return false;
  }

  const scope = globalThis as {
    window?: unknown;
    Worker?: unknown;
    Blob?: unknown;
    URL?: { createObjectURL?: unknown };
  };

  return Boolean(
    scope.window &&
      typeof scope.Worker === 'function' &&
      typeof scope.Blob === 'function' &&
      scope.URL &&
      typeof scope.URL.createObjectURL === 'function',
  );
}

function toSerializedWorkerError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

function fromSerializedWorkerError(error: SerializedWorkerError): Error {
  const output = new Error(error.message);
  output.name = error.name;
  output.stack = error.stack;
  return output;
}

function snapshotSession(session: BoxelRuntimeSession): BoxelRuntimeSessionSnapshot {
  return {
    source: cloneValue(session.source),
    state: cloneValue(session.state),
    result: cloneValue(session.result),
  };
}

function isWorkerRuntimeScope(): boolean {
  const scope = globalThis as {
    document?: unknown;
    postMessage?: unknown;
    addEventListener?: unknown;
  };

  return Boolean(
    typeof scope.document === 'undefined' &&
      typeof scope.postMessage === 'function' &&
      typeof scope.addEventListener === 'function',
  );
}

export function __runBoxelRuntimeWorker() {
  if (!isWorkerRuntimeScope()) {
    throw new Error('Boxel runtime worker bootstrap must run inside a worker.');
  }

  const scope = globalThis as unknown as {
    addEventListener(
      type: 'message',
      listener: (event: MessageEventLike<WorkerRequest>) => void,
    ): void;
    postMessage(message: WorkerResponse): void;
    __boxelRuntimeWorkerStarted?: boolean;
  };

  if (scope.__boxelRuntimeWorkerStarted) {
    return;
  }
  scope.__boxelRuntimeWorkerStarted = true;

  const plans = new Map<string, WorkerPlanEntry>();
  const sessions = new Map<string, BoxelRuntimeSession>();

  const ensurePlan = async (payload: PreparePlanPayload): Promise<WorkerPlanEntry> => {
    let entry = plans.get(payload.cacheKey);
    if (!entry) {
      const prepared = prepareBoxelRuntime(
        payload.definition,
        await resolveLazyBoxelRuntimeOptions(payload.definition, payload.options),
      );
      entry = {
        prepared,
        metadata: {
          cacheKey: payload.cacheKey,
          cacheNamespace: payload.cacheNamespace,
          contentHash: payload.contentHash,
          guideUrl: payload.guideUrl,
          schema: cloneValue(prepared.schema),
          warnings: cloneValue(prepared.warnings),
          rules: cloneValue(prepared.rules),
        },
      };
      plans.set(payload.cacheKey, entry);
    }
    return entry;
  };

  scope.addEventListener('message', async (event) => {
    const request = event.data;

    try {
      switch (request.type) {
        case 'ensure-plan': {
          const prepared = await ensurePlan(request);
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: cloneValue(prepared.metadata),
          });
          return;
        }
        case 'invalidate-plans': {
          let removed = 0;

          if (request.cacheKey) {
            removed = plans.delete(request.cacheKey) ? 1 : 0;
          } else if (request.cacheNamespace) {
            for (const [cacheKey, entry] of plans.entries()) {
              if (entry.metadata.cacheNamespace !== request.cacheNamespace) {
                continue;
              }
              plans.delete(cacheKey);
              removed += 1;
            }
          } else {
            removed = plans.size;
            plans.clear();
          }

          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: removed,
          });
          return;
        }
        case 'evaluate-plan': {
          const entry = plans.get(request.cacheKey);
          if (!entry) {
            throw new Error(`No prepared Boxel runtime plan for ${request.cacheKey}`);
          }
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: cloneValue(entry.prepared.evaluate(request.input)),
          });
          return;
        }
        case 'create-session': {
          const entry = plans.get(request.cacheKey);
          if (!entry) {
            throw new Error(`No prepared Boxel runtime plan for ${request.cacheKey}`);
          }
          const session = entry.prepared.createSession(request.initialInput);
          sessions.set(request.sessionId, session);
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: snapshotSession(session),
          });
          return;
        }
        case 'session-evaluate': {
          const session = sessions.get(request.sessionId);
          if (!session) {
            throw new Error(`No Boxel runtime session ${request.sessionId}`);
          }
          session.evaluate();
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: snapshotSession(session),
          });
          return;
        }
        case 'session-replace': {
          const session = sessions.get(request.sessionId);
          if (!session) {
            throw new Error(`No Boxel runtime session ${request.sessionId}`);
          }
          session.replace(request.input);
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: snapshotSession(session),
          });
          return;
        }
        case 'session-apply-patch': {
          const session = sessions.get(request.sessionId);
          if (!session) {
            throw new Error(`No Boxel runtime session ${request.sessionId}`);
          }
          session.applyPatch(request.path, request.value);
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: snapshotSession(session),
          });
          return;
        }
        case 'session-swap-plan': {
          const session = sessions.get(request.sessionId);
          if (!session) {
            throw new Error(`No Boxel runtime session ${request.sessionId}`);
          }
          const entry = plans.get(request.cacheKey);
          if (!entry) {
            throw new Error(`No prepared Boxel runtime plan for ${request.cacheKey}`);
          }
          const nextSession = entry.prepared.createSession(session.source);
          nextSession.evaluate();
          sessions.set(request.sessionId, nextSession);
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: snapshotSession(nextSession),
          });
          return;
        }
        case 'session-dispose': {
          sessions.delete(request.sessionId);
          scope.postMessage({
            requestId: request.requestId,
            ok: true,
            value: null,
          });
          return;
        }
      }
    } catch (error) {
      scope.postMessage({
        requestId: request.requestId,
        ok: false,
        error: toSerializedWorkerError(error),
      });
    }
  });
}

class BoxelRuntimeWorkerManager {
  #worker: WorkerLike;
  #requestCounter = 0;
  #pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
    }
  >();

  constructor() {
    this.#worker = this.#createWorker();
    this.#worker.addEventListener('message', (event) => {
      const response = event.data;
      const pending = this.#pending.get(response.requestId);
      if (!pending) {
        return;
      }
      this.#pending.delete(response.requestId);
      if (response.ok) {
        pending.resolve(response.value);
      } else {
        pending.reject(fromSerializedWorkerError(response.error));
      }
    });
    this.#worker.addEventListener('error', (event) => {
      const error = event.error ?? new Error(event.message);
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
    });
  }

  #createWorker(): WorkerLike {
    const bootstrap = [
      `import { __runBoxelRuntimeWorker } from ${JSON.stringify(import.meta.url)};`,
      '__runBoxelRuntimeWorker();',
    ].join('\n');
    const scope = globalThis as { Worker?: WorkerConstructorLike };
    const WorkerCtor = scope.Worker;
    if (!WorkerCtor) {
      throw new Error('Web Worker constructor is unavailable.');
    }
    const objectUrl = URL.createObjectURL(
      new Blob([bootstrap], { type: 'text/javascript' }),
    );
    const worker = new WorkerCtor(objectUrl, {
      name: 'boxel-runtime',
      type: 'module',
    });
    URL.revokeObjectURL(objectUrl);
    return worker;
  }

  async request<T>(request: WorkerRequestWithoutId): Promise<T> {
    const requestId = `boxel-runtime-request-${++this.#requestCounter}`;
    const promise = new Promise<T>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve(value) {
          resolve(value as T);
        },
        reject,
      });
    });
    this.#worker.postMessage({ ...request, requestId } as WorkerRequest);
    return promise;
  }

  ensurePlan(payload: PreparePlanPayload) {
    return this.request<PreparedPlanMetadata>({
      type: 'ensure-plan',
      ...payload,
    });
  }

  invalidatePlans(cacheKey?: string, cacheNamespace?: string) {
    return this.request<number>({
      type: 'invalidate-plans',
      cacheKey,
      cacheNamespace,
    });
  }

  evaluate(cacheKey: string, input: unknown) {
    return this.request<BoxelRuntimeResult>({
      type: 'evaluate-plan',
      cacheKey,
      input,
    });
  }

  createSession(cacheKey: string, sessionId: string, initialInput: unknown) {
    return this.request<BoxelRuntimeSessionSnapshot>({
      type: 'create-session',
      cacheKey,
      sessionId,
      initialInput,
    });
  }

  evaluateSession(sessionId: string) {
    return this.request<BoxelRuntimeSessionSnapshot>({
      type: 'session-evaluate',
      sessionId,
    });
  }

  replaceSession(sessionId: string, input: unknown) {
    return this.request<BoxelRuntimeSessionSnapshot>({
      type: 'session-replace',
      sessionId,
      input,
    });
  }

  applyPatchToSession(sessionId: string, path: string, value: unknown) {
    return this.request<BoxelRuntimeSessionSnapshot>({
      type: 'session-apply-patch',
      sessionId,
      path,
      value,
    });
  }

  swapSessionPlan(sessionId: string, cacheKey: string) {
    return this.request<BoxelRuntimeSessionSnapshot>({
      type: 'session-swap-plan',
      sessionId,
      cacheKey,
    });
  }

  disposeSession(sessionId: string) {
    return this.request<void>({
      type: 'session-dispose',
      sessionId,
    });
  }
}

let boxelRuntimeWorkerManager: BoxelRuntimeWorkerManager | null = null;
const preparedAsyncRuntimeCache = new Map<
  string,
  AsyncPreparedRuntimeCacheEntry
>();
let boxelRuntimeSessionCounter = 0;

function getBoxelRuntimeWorkerManager(): BoxelRuntimeWorkerManager {
  if (!boxelRuntimeWorkerManager) {
    boxelRuntimeWorkerManager = new BoxelRuntimeWorkerManager();
  }
  return boxelRuntimeWorkerManager;
}

function nextAsyncSessionId(): string {
  boxelRuntimeSessionCounter += 1;
  return `boxel-runtime-session-${boxelRuntimeSessionCounter}`;
}

function getCachedPreparedAsyncRuntime(cacheKey: string) {
  const entry = preparedAsyncRuntimeCache.get(cacheKey);
  if (!entry) {
    return undefined;
  }

  if (entry.promise) {
    return entry.promise;
  }

  const prepared = entry.runtimeRef?.deref();
  if (prepared) {
    return Promise.resolve(prepared);
  }

  preparedAsyncRuntimeCache.delete(cacheKey);
  if (entry.workerBacked && boxelRuntimeWorkerManager) {
    void boxelRuntimeWorkerManager.invalidatePlans(cacheKey).catch(
      () => undefined,
    );
  }
  return undefined;
}

function setCachedPreparedAsyncRuntime(entry: AsyncPreparedRuntimeCacheEntry) {
  preparedAsyncRuntimeCache.set(entry.cacheKey, entry);
}

function deleteCachedPreparedAsyncRuntime(cacheKey: string) {
  preparedAsyncRuntimeCache.delete(cacheKey);
}

function cleanupStalePreparedAsyncRuntimes(
  cacheKeyOrNamespace?: string,
) {
  for (const [cacheKey, entry] of preparedAsyncRuntimeCache.entries()) {
    if (
      cacheKeyOrNamespace &&
      cacheKey !== cacheKeyOrNamespace &&
      entry.cacheNamespace !== cacheKeyOrNamespace
    ) {
      continue;
    }
    if (entry.promise) {
      continue;
    }
    if (entry.runtimeRef?.deref()) {
      continue;
    }
    preparedAsyncRuntimeCache.delete(cacheKey);
    if (entry.workerBacked && boxelRuntimeWorkerManager) {
      void boxelRuntimeWorkerManager.invalidatePlans(cacheKey).catch(
        () => undefined,
      );
    }
  }
}

function prunePreparedAsyncRuntimeNamespace(
  cacheNamespace: string,
  retainedCacheKey: string,
  workerBacked: boolean,
) {
  for (const [cacheKey, entry] of preparedAsyncRuntimeCache.entries()) {
    if (
      cacheKey === retainedCacheKey ||
      entry.cacheNamespace !== cacheNamespace ||
      Boolean(entry.workerBacked) !== workerBacked
    ) {
      continue;
    }
    preparedAsyncRuntimeCache.delete(cacheKey);
  }
}

function invalidateLocalPreparedAsyncRuntimeCache(
  cacheKeyOrNamespace?: string,
): number {
  cleanupStalePreparedAsyncRuntimes(cacheKeyOrNamespace);

  if (!cacheKeyOrNamespace) {
    const removed = preparedAsyncRuntimeCache.size;
    preparedAsyncRuntimeCache.clear();
    return removed;
  }

  let removed = 0;
  for (const [cacheKey, entry] of preparedAsyncRuntimeCache.entries()) {
    if (
      cacheKey !== cacheKeyOrNamespace &&
      entry.cacheNamespace !== cacheKeyOrNamespace
    ) {
      continue;
    }
    preparedAsyncRuntimeCache.delete(cacheKey);
    removed += 1;
  }

  return removed;
}

function getLocalAsyncPreparedRuntime(
  prepared: PreparedBoxelRuntimeAsync,
): PreparedBoxelRuntime | null {
  return (
    prepared as LocalAsyncPreparedRuntimeHandle
  )[LOCAL_ASYNC_PREPARED_RUNTIME] ?? null;
}

function getWorkerAsyncPreparedRuntime(
  prepared: PreparedBoxelRuntimeAsync,
): { manager: BoxelRuntimeWorkerManager; metadata: PreparedPlanMetadata } | null {
  return (
    prepared as WorkerAsyncPreparedRuntimeHandle
  )[WORKER_ASYNC_PREPARED_RUNTIME] ?? null;
}

abstract class BaseAsyncBoxelRuntimeSession implements BoxelRuntimeAsyncSession {
  ready: Promise<void>;
  #source: unknown;
  #state: unknown;
  #result: BoxelRuntimeResult | null;
  #operationQueue: Promise<void> = Promise.resolve();

  protected constructor(initialInput: unknown) {
    this.#source = cloneValue(initialInput);
    this.#state = cloneValue(initialInput);
    this.#result = null;
    this.ready = Promise.resolve();
  }

  get source() {
    return this.#source;
  }

  get state() {
    return this.#state;
  }

  get result() {
    return this.#result;
  }

  protected applySnapshot(snapshot: BoxelRuntimeSessionSnapshot) {
    this.#source = snapshot.source;
    this.#state = snapshot.state;
    this.#result = snapshot.result;
  }

  protected queue<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const next = this.#operationQueue.then(operation, operation);
    this.#operationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  protected abstract initialize(): Promise<void>;

  protected abstract evaluateRemote(): Promise<BoxelRuntimeSessionSnapshot>;

  protected abstract replaceRemote(
    input: unknown,
  ): Promise<BoxelRuntimeSessionSnapshot>;

  protected abstract applyPatchRemote(
    path: string,
    value: unknown,
  ): Promise<BoxelRuntimeSessionSnapshot>;

  protected abstract swapPlanRemote(
    prepared: PreparedBoxelRuntimeAsync,
  ): Promise<BoxelRuntimeSessionSnapshot>;

  protected abstract disposeRemote(): Promise<void>;

  async evaluate(): Promise<BoxelRuntimeResult> {
    return this.queue(async () => {
      await this.ready;
      const snapshot = await this.evaluateRemote();
      this.applySnapshot(snapshot);
      return snapshot.result ?? buildMissingRuntimeResultError();
    });
  }

  async replace(input: unknown): Promise<BoxelRuntimeResult> {
    return this.queue(async () => {
      await this.ready;
      const snapshot = await this.replaceRemote(input);
      this.applySnapshot(snapshot);
      return snapshot.result ?? buildMissingRuntimeResultError();
    });
  }

  async applyPatch(path: string, value: unknown): Promise<BoxelRuntimeResult> {
    return this.queue(async () => {
      await this.ready;
      const snapshot = await this.applyPatchRemote(path, value);
      this.applySnapshot(snapshot);
      return snapshot.result ?? buildMissingRuntimeResultError();
    });
  }

  async swapPlan(
    prepared: PreparedBoxelRuntimeAsync,
  ): Promise<BoxelRuntimeResult> {
    return this.queue(async () => {
      await this.ready;
      const snapshot = await this.swapPlanRemote(prepared);
      this.applySnapshot(snapshot);
      return snapshot.result ?? buildMissingRuntimeResultError();
    });
  }

  async dispose(): Promise<void> {
    await this.queue(async () => {
      await this.ready.catch(() => undefined);
      await this.disposeRemote();
    });
  }
}

function buildMissingRuntimeResultError(): never {
  throw new Error('Boxel runtime session did not return a result.');
}

class LocalAsyncBoxelRuntimeSession extends BaseAsyncBoxelRuntimeSession {
  #session: BoxelRuntimeSession;

  constructor(session: BoxelRuntimeSession, initialInput: unknown) {
    super(initialInput);
    this.#session = session;
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {}

  protected async evaluateRemote(): Promise<BoxelRuntimeSessionSnapshot> {
    this.#session.evaluate();
    return snapshotSession(this.#session);
  }

  protected async replaceRemote(
    input: unknown,
  ): Promise<BoxelRuntimeSessionSnapshot> {
    this.#session.replace(input);
    return snapshotSession(this.#session);
  }

  protected async applyPatchRemote(
    path: string,
    value: unknown,
  ): Promise<BoxelRuntimeSessionSnapshot> {
    this.#session.applyPatch(path, value);
    return snapshotSession(this.#session);
  }

  protected async swapPlanRemote(
    prepared: PreparedBoxelRuntimeAsync,
  ): Promise<BoxelRuntimeSessionSnapshot> {
    const localPrepared = getLocalAsyncPreparedRuntime(prepared);
    if (!localPrepared) {
      throw new Error(
        'Cannot swap a local async Boxel runtime session to a worker-backed prepared plan. Recreate the session with the new prepared runtime instead.',
      );
    }

    this.#session = localPrepared.createSession(this.source);
    this.#session.evaluate();
    return snapshotSession(this.#session);
  }

  protected async disposeRemote(): Promise<void> {}
}

class WorkerBackedBoxelRuntimeSession extends BaseAsyncBoxelRuntimeSession {
  #manager: BoxelRuntimeWorkerManager;
  #cacheKey: string;
  #sessionId: string;

  constructor(
    manager: BoxelRuntimeWorkerManager,
    cacheKey: string,
    initialInput: unknown,
  ) {
    super(initialInput);
    this.#manager = manager;
    this.#cacheKey = cacheKey;
    this.#sessionId = nextAsyncSessionId();
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    const snapshot = await this.#manager.createSession(
      this.#cacheKey,
      this.#sessionId,
      this.source,
    );
    this.applySnapshot(snapshot);
  }

  protected evaluateRemote(): Promise<BoxelRuntimeSessionSnapshot> {
    return this.#manager.evaluateSession(this.#sessionId);
  }

  protected replaceRemote(input: unknown): Promise<BoxelRuntimeSessionSnapshot> {
    return this.#manager.replaceSession(this.#sessionId, input);
  }

  protected applyPatchRemote(
    path: string,
    value: unknown,
  ): Promise<BoxelRuntimeSessionSnapshot> {
    return this.#manager.applyPatchToSession(this.#sessionId, path, value);
  }

  protected async swapPlanRemote(
    prepared: PreparedBoxelRuntimeAsync,
  ): Promise<BoxelRuntimeSessionSnapshot> {
    const workerPrepared = getWorkerAsyncPreparedRuntime(prepared);
    if (!workerPrepared) {
      throw new Error(
        'Cannot swap a worker-backed Boxel runtime session to a local prepared plan. Recreate the session with the new prepared runtime instead.',
      );
    }

    this.#cacheKey = workerPrepared.metadata.cacheKey;
    return this.#manager.swapSessionPlan(
      this.#sessionId,
      workerPrepared.metadata.cacheKey,
    );
  }

  protected disposeRemote(): Promise<void> {
    return this.#manager.disposeSession(this.#sessionId);
  }
}

async function createLocalAsyncPreparedBoxelRuntime(
  payload: PreparePlanPayload,
): Promise<PreparedBoxelRuntimeAsync> {
  const prepared = prepareBoxelRuntime(
    payload.definition,
    await resolveLazyBoxelRuntimeOptions(payload.definition, payload.options),
  );
  const runtime: LocalAsyncPreparedRuntimeHandle = {
    cacheKey: payload.cacheKey,
    cacheNamespace: payload.cacheNamespace,
    contentHash: payload.contentHash,
    guideUrl: payload.guideUrl,
    schema: prepared.schema,
    warnings: prepared.warnings,
    rules: prepared.rules,
    async evaluate(input: unknown) {
      return prepared.evaluate(input);
    },
    createSession(initialInput: unknown) {
      return new LocalAsyncBoxelRuntimeSession(
        prepared.createSession(initialInput),
        initialInput,
      );
    },
  };
  runtime[LOCAL_ASYNC_PREPARED_RUNTIME] = prepared;
  return runtime;
}

function createWorkerBackedPreparedBoxelRuntime(
  manager: BoxelRuntimeWorkerManager,
  metadata: PreparedPlanMetadata,
): PreparedBoxelRuntimeAsync {
  const runtime: WorkerAsyncPreparedRuntimeHandle = {
    cacheKey: metadata.cacheKey,
    cacheNamespace: metadata.cacheNamespace,
    contentHash: metadata.contentHash,
    guideUrl: metadata.guideUrl,
    schema: metadata.schema,
    warnings: metadata.warnings,
    rules: metadata.rules,
    evaluate(input: unknown) {
      return manager.evaluate(metadata.cacheKey, input);
    },
    createSession(initialInput: unknown) {
      return new WorkerBackedBoxelRuntimeSession(
        manager,
        metadata.cacheKey,
        initialInput,
      );
    },
  };
  runtime[WORKER_ASYNC_PREPARED_RUNTIME] = {
    manager,
    metadata,
  };
  return runtime;
}

export async function prepareBoxelRuntimeAsync(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeAsyncOptions = {},
): Promise<PreparedBoxelRuntimeAsync> {
  const payload = createPreparedPlanPayload(definition, options);
  cleanupStalePreparedAsyncRuntimes(payload.cacheNamespace);
  const useWorkerRuntime = canUseBrowserWorkerRuntime(options);

  const cached = getCachedPreparedAsyncRuntime(payload.cacheKey);
  if (cached) {
    return cached;
  }

  const cacheEntry: AsyncPreparedRuntimeCacheEntry = {
    cacheKey: payload.cacheKey,
    cacheNamespace: payload.cacheNamespace,
  };
  const preparedPromise = (async () => {
    const prepared = !useWorkerRuntime
      ? await createLocalAsyncPreparedBoxelRuntime(payload)
      : createWorkerBackedPreparedBoxelRuntime(
          getBoxelRuntimeWorkerManager(),
          await getBoxelRuntimeWorkerManager().ensurePlan(payload),
        );

    cacheEntry.workerBacked = Boolean(
      getWorkerAsyncPreparedRuntime(prepared),
    );
    cacheEntry.runtimeRef =
      typeof WeakRef === 'function' ? new WeakRef(prepared) : undefined;
    cacheEntry.promise = cacheEntry.runtimeRef
      ? undefined
      : Promise.resolve(prepared);
    if (!useWorkerRuntime) {
      prunePreparedAsyncRuntimeNamespace(
        payload.cacheNamespace,
        payload.cacheKey,
        false,
      );
    }

    return prepared;
  })();

  cacheEntry.promise = preparedPromise;
  setCachedPreparedAsyncRuntime(cacheEntry);

  try {
    return await preparedPromise;
  } catch (error) {
    deleteCachedPreparedAsyncRuntime(payload.cacheKey);
    throw error;
  }
}

export async function invalidateBoxelRuntimeAsyncCache(
  cacheKeyOrNamespace?: string,
): Promise<number> {
  const exactCacheKey = cacheKeyOrNamespace?.startsWith(
    `${BOXEL_RUNTIME_ASYNC_PROTOCOL}::`,
  )
    ? cacheKeyOrNamespace
    : undefined;
  const localInvalidated = invalidateLocalPreparedAsyncRuntimeCache(
    cacheKeyOrNamespace,
  );

  let workerInvalidated = 0;
  if (boxelRuntimeWorkerManager) {
    workerInvalidated = await boxelRuntimeWorkerManager.invalidatePlans(
      exactCacheKey,
      cacheKeyOrNamespace,
    );
  }

  return Math.max(localInvalidated, workerInvalidated);
}

export function prepareBoxelGuideAsync(
  guide: BoxelGuideSpec,
  options: BoxelRuntimeAsyncOptions = {},
): Promise<PreparedBoxelRuntimeAsync> {
  return prepareBoxelRuntimeAsync({ guide }, options);
}

export async function prepareBoxelRuntimeAsyncSafe(
  definition: BoxelRuntimeDefinition,
  options: BoxelRuntimeAsyncOptions = {},
): Promise<BxlSafeResult<PreparedBoxelRuntimeAsync>> {
  try {
    return {
      ok: true,
      value: await prepareBoxelRuntimeAsync(definition, options),
    };
  } catch (error) {
    return {
      ok: false,
      error: toBxlErrorRecord(error, 'prepare'),
    };
  }
}

export function prepareBoxelGuideAsyncSafe(
  guide: BoxelGuideSpec,
  options: BoxelRuntimeAsyncOptions = {},
): Promise<BxlSafeResult<PreparedBoxelRuntimeAsync>> {
  return prepareBoxelRuntimeAsyncSafe({ guide }, options);
}
