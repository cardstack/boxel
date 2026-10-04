// Pretui — forms/expression territory: the rule & condition AUTHORING
// surface. Three components (ExpressionBuilder, RuleRow, FilterSet) plus the
// pure string/token helpers they share.
//
// Ported from Salesforce Lightning Design System `ui/components/expression/`
// (`base/`, `custom-logic/`, `filters/`; the `formula/` variant is dropped —
// see below). SLDS supplies the layout and the interaction vocabulary:
// condition rows of (resource, operator, value), an any/all joiner, a
// custom-logic string like `1 AND (2 OR 3)` that references row NUMBERS, and
// per-row add/delete controls.
//
// WHAT THIS COMPONENT DOES NOT DO — the hard architectural rule of the forms
// territory: **it never evaluates anything.** There is no BXL import here, no
// `prepareBxlSafe`, no `evaluate`. It edits rule DATA and composes a BXL
// STRING for the caller to persist. Evaluation happens elsewhere and fails
// closed. Anything that looks like a result in a demo was passed in canned
// (`@status` on RuleRow).
//
// The record it edits is the BXL guide rule, verbatim, no second shape:
//   { ruleId, label, severity, targetPath, message, expression }
//
// ── What the inspiration got wrong, and what we fixed ────────────────────
//
// 1. SLDS has NO reorder. Rows can only be appended and deleted — yet the
//    custom-logic string references row POSITIONS, so position is meaningful
//    and un-editable. We add keyboard-first Move up / Move down.
// 2. SLDS renumbers nothing. Its examples are static JSX; the real Lightning
//    builder is notorious for leaving dangling references after a delete.
//    We remap the custom-logic string from STABLE ROW IDS on every structural
//    change (never by arithmetic on the numbers), remove the operator orphaned
//    by a dropped reference, collapse the resulting empty groups, and then
//    VALIDATE and show what is still wrong rather than silently repairing it.
// 3. SLDS's row identity lives entirely in a `<legend>` whose assistive text
//    ("Condition 1") most screen readers announce once, on entry to the
//    fieldset. Every control inside is then labelled "Resource" / "Operator" /
//    "Value" — identical in every row. We keep the fieldset+legend AND give
//    every control its own accessible name carrying the row number
//    ("Condition 3 resource"), so a control reached by Tab, by virtual cursor,
//    or by a forms-mode jump always identifies its row.
// 4. SLDS never moves focus. Deleting a row destroys the focused button and
//    drops focus to `<body>`. We move focus to the row that took the deleted
//    row's place (or the previous row, or the Add button) and announce the
//    change in a live region.
// 5. SLDS `disabled`s the delete button on the only remaining row — the
//    classic focus-loss trap. Our end-of-list Move buttons use `aria-disabled`
//    and stay focusable, so repeated Up presses never eject the user.
// 6. SLDS hardcodes `$size-small` / `$spacing-*` Sass at build time and cannot
//    respond to its own pane. Every dimension here is a token with a light
//    literal fallback, and the row collapses to a stacked layout on an
//    unnamed container query.
// 7. The row count is nowhere in SLDS's accessibility tree. Ours is in the
//    list's accessible name and in the live region.
//
// DROPPED from the upstream surface, and why:
// - `formula/` (the rich-text formula editor with an insertion toolbar). It
//   needs a rich-text engine; Law 9 forbids vendoring one. A caller who wants
//   free-form BXL edits `rule.expression` directly — RuleRow shows it.
// - Nested condition GROUPS (`ExpressionGroup`, `slds-expression__group`).
//   Custom logic already expresses grouping with parentheses over one flat
//   row list, and a flat list is what keeps stable-id remapping provable.
//   Named here rather than half-shipped (Law 7).
// - The `Combobox`+`Listbox` type-ahead resource picker. Pretui `Select` is
//   the one select in the kit and already grows a search box past 7 options.
// - `slds-is-new` / `slds-is-locked` filter-item states — no consumer yet.
//
// Pretui — the expression model, operator catalogue, custom-logic tokens and BXL composition.
import type { SelectOption } from '../components/select';
import { iconFor } from '../icon-registry';

export const AddIcon = iconFor('plus');
export const RemoveIcon = iconFor('circle-minus');
export const MoveIcon = iconFor('chevron-down');
export const MoreIcon = iconFor('ellipsis');
export const PencilIcon = iconFor('pencil');
export const FunnelIcon = iconFor('filter');

// ── The data model ───────────────────────────────────────────────────────

/**
 * One rule in BXL guide shape — the record the caller persists. This is the
 * SAME shape as `bxl-guide-validation`'s rule data and as `boxel-widgets`'
 * message contract upstream of it; nothing here invents a variant of it.
 *
 * `expression` is a BXL source STRING. This module composes it
 * (`expressionToBxl`) and never runs it.
 */
export interface GuideRule {
  /** stable id, the provenance key an emitted issue points back to */
  ruleId: string;
  /** human name of the rule, shown in rule lists */
  label: string;
  /** 'error' blocks; anything else is advisory. Unknown values fail closed. */
  severity: 'error' | 'warning' | 'info' | (string & {});
  /** BXL label path the failure points at. Bare for simple labels (`Total`),
   * quoted when it contains spaces (`"Approver Email"`), predicate form for
   * rows (`"Line Item"[SKU = "DHP-04"].Quantity`). Treated as ONE opaque
   * string everywhere in this file — never split on '.'. */
  targetPath: string;
  /** message rendered verbatim when the rule fails */
  message: string;
  /** BXL source. Composed from an ExpressionModel, or hand-written. */
  expression: string;
}

/** How the condition rows combine. Mirrors SLDS's any/all/custom/always. */
export type ExpressionLogic = 'all' | 'any' | 'custom' | 'always';

/**
 * One condition row. `id` is the row's identity for the lifetime of the edit
 * session and is NEVER renumbered — the display number is derived from array
 * position, and custom-logic references are remapped through these ids.
 */
export interface ExpressionCondition {
  /** stable row id; not persisted in the guide rule */
  id: string;
  /** BXL label path of the left operand — opaque, never parsed */
  targetPath: string;
  /** operator token, matched against the row's operator catalogue */
  operator: string;
  /** right operand as the caller's value control produced it */
  value: string;
  /** what `value` MEANS. `literal` (the default) quotes it for BXL; `path`
   * emits it verbatim, so a condition can compare two fields — "Total must
   * not exceed the approved budget". SLDS's published component has no field-
   * to-field comparison at all even though the shipping Lightning builder
   * does; this is the smallest honest way to close that gap. */
  valueKind?: 'literal' | 'path';
}

/** The editor's working state. `expression` on the GuideRule is derived from
 * this; this is not a second rule shape, it is the authoring projection. */
export interface ExpressionModel {
  logic: ExpressionLogic;
  /** row-number logic, meaningful only while `logic === 'custom'` */
  customLogic: string;
  conditions: ExpressionCondition[];
}

/** A field the builder can put on the left of a condition. */
export interface ExpressionResource {
  /** the BXL label path, already quoted if it needs quoting — used verbatim */
  value: string;
  /** what the picker shows */
  label: string;
  /** picks the default operator catalogue and how the value is quoted */
  type?: ExpressionValueType;
  /** choices handed to the value slot for picklist-typed resources */
  options?: SelectOption[];
  /** override the operator catalogue for this resource only */
  operators?: ExpressionOperator[];
}

export type ExpressionValueType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'boolean'
  | 'picklist';

/** One operator offered in the middle column. */
export interface ExpressionOperator {
  /** the token stored on the condition */
  value: string;
  /** what the picker shows — SLDS wording ('equals', 'greater than') */
  label: string;
  /** 0 = unary (`is empty`); the value column is suppressed */
  arity?: 0 | 1;
  /** BXL template. `{path}`, `{op}` and `{value}` are substituted. Defaults
   * to `{path} {op} {value}`, or `{path} {op}` when arity is 0. */
  bxl?: string;
  /** prose form used by `conditionSummary` / FilterSet. Defaults to `label`. */
  summary?: string;
}

/**
 * An authoring-time problem with the expression being edited — a dangling
 * custom-logic reference, an incomplete row.
 *
 * Deliberately NOT `FormIssue` (forms-core): a FormIssue is keyed by the
 * `targetPath` of a record field that failed a rule at RUNTIME. These are
 * keyed by condition id and describe the rule DOCUMENT, not any record. They
 * meet at RuleRow, where `@status` accepts a canned runtime verdict.
 */
export interface ExpressionIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** the row it belongs to; absent means expression-level */
  conditionId?: string;
}

/** Canned runtime verdict handed to RuleRow. Nothing here computes it. */
export type RuleStatus = 'pass' | 'fail' | 'error' | 'unknown';

// ── Operator catalogue ───────────────────────────────────────────────────

const TEXT_OPERATORS: ExpressionOperator[] = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'does not equal' },
  {
    value: 'contains',
    label: 'contains',
    bxl: '{path} | contains({value})',
    summary: 'contains',
  },
  {
    value: 'starts with',
    label: 'starts with',
    bxl: '{path} | startswith({value})',
    summary: 'starts with',
  },
  {
    value: 'is empty',
    label: 'is empty',
    arity: 0,
    bxl: '({path} | length) = 0',
    summary: 'is empty',
  },
  {
    value: 'is not empty',
    label: 'is not empty',
    arity: 0,
    bxl: '({path} | length) > 0',
    summary: 'is not empty',
  },
];

const NUMBER_OPERATORS: ExpressionOperator[] = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'does not equal' },
  { value: '>', label: 'greater than' },
  { value: '>=', label: 'at least' },
  { value: '<', label: 'less than' },
  { value: '<=', label: 'at most' },
];

const DATE_OPERATORS: ExpressionOperator[] = [
  { value: '=', label: 'on' },
  { value: '>', label: 'after' },
  { value: '>=', label: 'on or after' },
  { value: '<', label: 'before' },
  { value: '<=', label: 'on or before' },
];

const BOOLEAN_OPERATORS: ExpressionOperator[] = [
  { value: '=', label: 'is' },
  { value: '!=', label: 'is not' },
];

const PICKLIST_OPERATORS: ExpressionOperator[] = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'does not equal' },
];

/** The operator catalogue a resource type gets when it names none itself. */
export function defaultOperatorsFor(
  type?: ExpressionValueType,
): ExpressionOperator[] {
  switch (type) {
    case 'number':
    case 'currency':
      return NUMBER_OPERATORS;
    case 'date':
      return DATE_OPERATORS;
    case 'boolean':
      return BOOLEAN_OPERATORS;
    case 'picklist':
      return PICKLIST_OPERATORS;
    default:
      return TEXT_OPERATORS;
  }
}

// Row ids must be stable and must not come from Math.random or Date.now
// (realm law). A module counter is deterministic per module load.
let CONDITION_SEQ = 0;

/** Mint an empty condition row. Pass `id` to keep an id across a rebuild. */
export function newCondition(
  partial: Partial<ExpressionCondition> = {},
): ExpressionCondition {
  CONDITION_SEQ += 1;
  return {
    id: partial.id ?? `xc${CONDITION_SEQ}`,
    targetPath: partial.targetPath ?? '',
    operator: partial.operator ?? '',
    value: partial.value ?? '',
    valueKind: partial.valueKind ?? 'literal',
  };
}

// ── Custom-logic tokens ──────────────────────────────────────────────────
//
// The custom-logic string is the one place row POSITION is load-bearing, so
// it is the one place a delete or a move can corrupt data. We never rewrite
// it with string replacement or index arithmetic. We tokenise it, map each
// numeric reference through a caller-supplied id-derived remap, repair the
// structure the removal broke, and re-serialise. Anything we cannot repair is
// left in place for `validateCustomLogic` to report — a silent repair of a
// rule the user cannot see is worse than a visible error.

export type LogicTokenKind = 'ref' | 'op' | 'open' | 'close' | 'other';

export interface LogicToken {
  kind: LogicTokenKind;
  /** verbatim source text; operator casing survives a rewrite */
  text: string;
  /** 1-based row reference, `ref` tokens only */
  index?: number;
}

const LOGIC_SCAN = /\d+|\(|\)|[A-Za-z_]+|[^\s]/g;
const LOGIC_WORDS = new Set(['AND', 'OR', 'NOT']);

function isBinaryOp(token: LogicToken): boolean {
  return token.kind === 'op' && token.text.toUpperCase() !== 'NOT';
}

/** Split a custom-logic string into tokens. Whitespace is dropped —
 * serialisation regenerates it — and unrecognised text is preserved as
 * `other` so the validator can point at it. */
export function tokenizeLogic(source: string): LogicToken[] {
  let out: LogicToken[] = [];
  LOGIC_SCAN.lastIndex = 0;
  let match = LOGIC_SCAN.exec(source);
  while (match) {
    let text = match[0];
    if (/^\d+$/.test(text)) {
      out.push({ kind: 'ref', text, index: Number(text) });
    } else if (text === '(') {
      out.push({ kind: 'open', text });
    } else if (text === ')') {
      out.push({ kind: 'close', text });
    } else if (LOGIC_WORDS.has(text.toUpperCase())) {
      out.push({ kind: 'op', text });
    } else {
      out.push({ kind: 'other', text });
    }
    match = LOGIC_SCAN.exec(source);
  }
  return out;
}

/** Tokens back to a canonically spaced string. */
export function serializeLogic(tokens: LogicToken[]): string {
  let out = '';
  for (let token of tokens) {
    let space = out.length > 0 && token.kind !== 'close' && !out.endsWith('(');
    out += space ? ` ${token.text}` : token.text;
  }
  return out;
}

function significant(
  tokens: LogicToken[],
  removed: boolean[],
  from: number,
  step: number,
): number {
  let i = from;
  while (i >= 0 && i < tokens.length) {
    if (!removed[i]) {
      return i;
    }
    i += step;
  }
  return -1;
}

// Structural repair after references were dropped: no dangling operators, no
// empty groups, no operator hanging off the start or end of a group.
function cleanupTokens(tokens: LogicToken[], removed: boolean[]): void {
  let changed = true;
  let guard = 0;
  while (changed && guard < 32) {
    changed = false;
    guard += 1;
    for (let i = 0; i < tokens.length; i++) {
      if (removed[i]) {
        continue;
      }
      let token = tokens[i]!;
      let prev = significant(tokens, removed, i - 1, -1);
      let next = significant(tokens, removed, i + 1, 1);
      // an empty group
      if (token.kind === 'open' && next >= 0 && tokens[next]!.kind === 'close') {
        removed[i] = true;
        removed[next] = true;
        let before = significant(tokens, removed, i - 1, -1);
        let after = significant(tokens, removed, next + 1, 1);
        if (before >= 0 && isBinaryOp(tokens[before]!)) {
          removed[before] = true;
        } else if (after >= 0 && isBinaryOp(tokens[after]!)) {
          removed[after] = true;
        }
        changed = true;
        continue;
      }
      if (!isBinaryOp(token)) {
        continue;
      }
      // a binary operator with nothing to its left, or nothing to its right
      let leftEmpty = prev < 0 || tokens[prev]!.kind === 'open';
      let rightEmpty = next < 0 || tokens[next]!.kind === 'close';
      if (leftEmpty || rightEmpty) {
        removed[i] = true;
        changed = true;
        continue;
      }
      // two binary operators in a row — keep the first
      if (isBinaryOp(tokens[next]!)) {
        removed[next] = true;
        changed = true;
      }
    }
    // a group wrapping exactly one reference adds nothing
    for (let i = 0; i < tokens.length; i++) {
      if (removed[i] || tokens[i]!.kind !== 'open') {
        continue;
      }
      let a = significant(tokens, removed, i + 1, 1);
      if (a < 0 || tokens[a]!.kind !== 'ref') {
        continue;
      }
      let b = significant(tokens, removed, a + 1, 1);
      if (b >= 0 && tokens[b]!.kind === 'close') {
        removed[i] = true;
        removed[b] = true;
        changed = true;
      }
    }
    // a group wrapping the WHOLE expression adds nothing either
    let head = significant(tokens, removed, 0, 1);
    if (head >= 0 && tokens[head]!.kind === 'open') {
      let depth = 0;
      let match = -1;
      for (let i = head; i < tokens.length; i++) {
        if (removed[i]) {
          continue;
        }
        if (tokens[i]!.kind === 'open') {
          depth += 1;
        } else if (tokens[i]!.kind === 'close') {
          depth -= 1;
          if (depth === 0) {
            match = i;
            break;
          }
        }
      }
      if (match >= 0 && match === significant(tokens, removed, tokens.length - 1, -1)) {
        removed[head] = true;
        removed[match] = true;
        changed = true;
      }
    }
  }
}

/**
 * Rewrite every row reference in a custom-logic string.
 *
 * `remap` receives a 1-based row number and returns its new 1-based number,
 * or `null` if that row no longer exists. Callers derive it from STABLE ROW
 * IDS (`before.indexOf(id)` → `after.indexOf(id)`), never from arithmetic —
 * one code path serves delete, move, duplicate and sort, so there is one
 * place for the renumbering bug to live and it is covered by all four.
 *
 * A reference the caller does not recognise is left untouched rather than
 * dropped, so `validateCustomLogic` reports it instead of the editor quietly
 * deleting a clause the author typed.
 */
export function remapCustomLogic(
  source: string,
  remap: (index: number) => number | null,
): string {
  let tokens = tokenizeLogic(source);
  let removed: boolean[] = tokens.map(() => false);

  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i]!;
    if (token.kind !== 'ref' || token.index === undefined) {
      continue;
    }
    let next = remap(token.index);
    if (next === null) {
      removed[i] = true;
      // the reference took an operator with it: prefer the one before it,
      // stepping over any prefix NOTs, and fall back to the one after.
      let prev = significant(tokens, removed, i - 1, -1);
      while (prev >= 0 && tokens[prev]!.kind === 'op' && !isBinaryOp(tokens[prev]!)) {
        removed[prev] = true;
        prev = significant(tokens, removed, prev - 1, -1);
      }
      if (prev >= 0 && isBinaryOp(tokens[prev]!)) {
        removed[prev] = true;
      } else {
        let after = significant(tokens, removed, i + 1, 1);
        if (after >= 0 && isBinaryOp(tokens[after]!)) {
          removed[after] = true;
        }
      }
    } else {
      tokens[i] = { kind: 'ref', text: String(next), index: next };
    }
  }

  cleanupTokens(tokens, removed);
  return serializeLogic(tokens.filter((_t, i) => !removed[i]));
}

/** `1 AND 2 AND 3` for `all`, `1 OR 2 OR 3` for `any`. */
export function seedCustomLogic(count: number, logic: ExpressionLogic): string {
  if (count < 1) {
    return '';
  }
  let joiner = logic === 'any' ? 'OR' : 'AND';
  let parts: string[] = [];
  for (let i = 1; i <= count; i++) {
    parts.push(String(i));
  }
  return parts.join(` ${joiner} `);
}

/** Append a reference to a new row, reusing the joiner already in the string. */
export function appendLogicRef(source: string, index: number): string {
  let trimmed = source.trim();
  if (!trimmed) {
    return String(index);
  }
  let tokens = tokenizeLogic(trimmed);
  let joiner = 'AND';
  for (let token of tokens) {
    if (isBinaryOp(token)) {
      joiner = token.text;
    }
  }
  return `${trimmed} ${joiner} ${index}`;
}

/**
 * Grammar + reference check for a custom-logic string. Returns issues; it
 * never throws and never edits. `count` is the number of condition rows.
 */
export function validateCustomLogic(
  source: string,
  count: number,
): ExpressionIssue[] {
  let issues: ExpressionIssue[] = [];
  let tokens = tokenizeLogic(source);
  if (tokens.length === 0) {
    if (count > 0) {
      issues.push({
        severity: 'error',
        message: 'Custom logic is empty. Reference each condition by number.',
      });
    }
    return issues;
  }

  let depth = 0;
  let expectTerm = true;
  let seen = new Set<number>();
  let structural = false;

  for (let token of tokens) {
    if (token.kind === 'other') {
      issues.push({
        severity: 'error',
        message: `“${token.text}” is not valid in custom logic. Use condition numbers, AND, OR, NOT and parentheses.`,
      });
      structural = true;
      continue;
    }
    if (token.kind === 'open') {
      if (!expectTerm) {
        structural = true;
      }
      depth += 1;
      expectTerm = true;
    } else if (token.kind === 'close') {
      if (expectTerm) {
        structural = true;
      }
      depth -= 1;
      if (depth < 0) {
        issues.push({
          severity: 'error',
          message: 'Custom logic has an unmatched “)”.',
        });
        return issues;
      }
      expectTerm = false;
    } else if (token.kind === 'ref') {
      if (!expectTerm) {
        structural = true;
      }
      let index = token.index ?? 0;
      seen.add(index);
      if (index < 1 || index > count) {
        issues.push({
          severity: 'error',
          message:
            count > 0
              ? `Custom logic references condition ${index}, but there ${count === 1 ? 'is' : 'are'} only ${count}.`
              : `Custom logic references condition ${index}, but there are no conditions.`,
        });
      }
      expectTerm = false;
    } else if (isBinaryOp(token)) {
      if (expectTerm) {
        structural = true;
      }
      expectTerm = true;
    } else {
      // NOT — a prefix operator, so a term is still expected after it
      if (!expectTerm) {
        structural = true;
      }
    }
  }

  if (depth > 0) {
    issues.push({
      severity: 'error',
      message: `Custom logic is missing ${depth === 1 ? 'a closing “)”' : `${depth} closing parentheses`}.`,
    });
  }
  if (expectTerm || structural) {
    issues.push({
      severity: 'error',
      message:
        'Custom logic is incomplete — every AND/OR needs a condition number on both sides.',
    });
  }
  for (let i = 1; i <= count; i++) {
    if (!seen.has(i)) {
      issues.push({
        severity: 'warning',
        message: `Condition ${i} is not used by the custom logic and will be ignored.`,
      });
    }
  }
  return issues;
}

// ── BXL composition — string building, never evaluation ──────────────────

/** Quote a raw value for BXL. Numbers and booleans stay literal; everything
 * else becomes a JSON double-quoted string, which is also how a stray quote
 * or backslash stays safe. An unparseable number is quoted rather than
 * emitted raw, so the failure is visible in the composed source. */
export function quoteBxlValue(raw: string, type?: ExpressionValueType): string {
  let value = raw ?? '';
  if (type === 'boolean') {
    let lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === 'false') {
      return lowered;
    }
    return JSON.stringify(value);
  }
  if (type === 'number' || type === 'currency') {
    let cleaned = value.replace(/[,\s]/g, '');
    if (cleaned !== '' && Number.isFinite(Number(cleaned))) {
      return cleaned;
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** Resolve the resource behind a condition's `targetPath` (whole-string
 * match — predicate paths contain dots, brackets, quotes and spaces). */
export function resourceFor(
  condition: ExpressionCondition,
  resources: ExpressionResource[],
): ExpressionResource | undefined {
  return resources.find((r) => r.value === condition.targetPath);
}

/** Resolve the operator spec behind a condition's operator token. */
export function operatorFor(
  condition: ExpressionCondition,
  operators: ExpressionOperator[],
): ExpressionOperator | undefined {
  return operators.find((o) => o.value === condition.operator);
}

export function operatorCatalogue(
  resource: ExpressionResource | undefined,
  fallback: ExpressionOperator[] | undefined,
): ExpressionOperator[] {
  return resource?.operators ?? fallback ?? defaultOperatorsFor(resource?.type);
}

/** BXL for one condition, or `''` when the row is not complete enough to
 * compose. Composition only — nothing is parsed or run. */
export function conditionToBxl(
  condition: ExpressionCondition,
  resources: ExpressionResource[] = [],
  fallbackOperators?: ExpressionOperator[],
): string {
  if (!condition.targetPath || !condition.operator) {
    return '';
  }
  let resource = resourceFor(condition, resources);
  let operator = operatorFor(
    condition,
    operatorCatalogue(resource, fallbackOperators),
  );
  let unary = operator?.arity === 0;
  if (!unary && (condition.value === undefined || condition.value === '')) {
    return '';
  }
  let template =
    operator?.bxl ?? (unary ? '{path} {op}' : '{path} {op} {value}');
  // a `path` value is another BXL label path from the same catalogue and goes
  // in verbatim; a `literal` is quoted for its type
  let right =
    condition.valueKind === 'path'
      ? condition.value
      : quoteBxlValue(condition.value, resource?.type);
  // replacer functions, so a `$` in a path or value is never a substitution pattern
  return template
    .replace('{path}', () => condition.targetPath)
    .replace('{op}', () => condition.operator)
    .replace('{value}', () => right);
}

/** Prose form of a condition — `Total greater than 10,000`. */
export function conditionSummary(
  condition: ExpressionCondition,
  resources: ExpressionResource[] = [],
  fallbackOperators?: ExpressionOperator[],
): string {
  let resource = resourceFor(condition, resources);
  let operator = operatorFor(
    condition,
    operatorCatalogue(resource, fallbackOperators),
  );
  let left = resource?.label ?? condition.targetPath;
  if (!left) {
    return 'New condition';
  }
  let middle = operator?.summary ?? operator?.label ?? condition.operator;
  if (!middle) {
    return left;
  }
  if (operator?.arity === 0) {
    return `${left} ${middle}`;
  }
  if (condition.value === '') {
    return `${left} ${middle} …`;
  }
  if (condition.valueKind === 'path') {
    let other = resources.find((r) => r.value === condition.value);
    return `${left} ${middle} ${other?.label ?? condition.value}`;
  }
  return `${left} ${middle} “${condition.value}”`;
}

export interface BxlComposeOptions {
  resources?: ExpressionResource[];
  operators?: ExpressionOperator[];
  /** BXL keyword for conjunction — default `and` */
  and?: string;
  /** BXL keyword for disjunction — default `or` */
  or?: string;
  /** BXL keyword for negation — default `not` */
  not?: string;
}

/**
 * Compose the whole expression into a BXL source string.
 *
 * This is the only bridge between the visual builder and `rule.expression`.
 * It is pure string building: the result is handed to the caller to persist,
 * and evaluated somewhere else, fail-closed.
 *
 * `always` composes to `true`. An expression whose rows are all incomplete
 * composes to `''` — an empty expression fails closed downstream, which is
 * the correct reading of "the author has not finished".
 */
export function expressionToBxl(
  model: ExpressionModel,
  options: BxlComposeOptions = {},
): string {
  let and = options.and ?? 'and';
  let or = options.or ?? 'or';
  let not = options.not ?? 'not';
  if (model.logic === 'always') {
    return 'true';
  }
  let parts = model.conditions.map((c) =>
    conditionToBxl(c, options.resources ?? [], options.operators),
  );

  if (model.logic === 'custom') {
    let tokens = tokenizeLogic(model.customLogic ?? '');
    if (tokens.length === 0) {
      return '';
    }
    let out = '';
    for (let token of tokens) {
      let text: string;
      if (token.kind === 'ref') {
        let part = parts[(token.index ?? 0) - 1];
        if (!part) {
          // an unresolvable reference cannot be silently skipped — the
          // composed source must not read as a weaker rule than authored
          return '';
        }
        text = `(${part})`;
      } else if (token.kind === 'op') {
        let upper = token.text.toUpperCase();
        text = upper === 'AND' ? and : upper === 'OR' ? or : not;
      } else if (token.kind === 'other') {
        return '';
      } else {
        text = token.text;
      }
      let space = out.length > 0 && token.kind !== 'close' && !out.endsWith('(');
      out += space ? ` ${text}` : text;
    }
    return out;
  }

  let usable = parts.filter((p) => p !== '');
  if (usable.length === 0) {
    return '';
  }
  if (usable.length === 1) {
    return usable[0]!;
  }
  let joiner = model.logic === 'any' ? or : and;
  return usable.map((p) => `(${p})`).join(` ${joiner} `);
}
