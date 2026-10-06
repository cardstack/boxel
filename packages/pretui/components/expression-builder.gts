// Pretui — ExpressionBuilder: conditions joined by all, any or custom logic, composed to BXL.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Button } from './button';
import { Field } from './field';
import { IconButton } from './icon-button';
import { Input } from './input';
import { Select } from './select';
import type { SelectOption } from './select';
import { ButtonGroup } from './button-group';
import { Menu } from './menu';
import type { MenuItemSpec } from '../internal/menu';
import { Chip } from './chip';
import { focusWhen } from '../focus';
import { AddIcon, MoreIcon, MoveIcon, RemoveIcon, appendLogicRef, conditionToBxl, newCondition, operatorCatalogue, operatorFor, remapCustomLogic, resourceFor, seedCustomLogic, tokenizeLogic, validateCustomLogic } from '../internal/forms-expression';
import type { ExpressionCondition, ExpressionIssue, ExpressionLogic, ExpressionModel, ExpressionOperator, ExpressionResource } from '../internal/forms-expression';

// ── ExpressionBuilder ────────────────────────────────────────────────────

/** Everything the `<:value>` slot needs to render the right-hand control. */
export interface ExpressionValueContext {
  /** the row being edited */
  condition: ExpressionCondition;
  /** 0-based array position */
  index: number;
  /** 1-based display number — the number custom logic references */
  number: number;
  /** the resolved left-hand resource, when the row has one */
  resource?: ExpressionResource;
  /** the resolved operator spec, when the row has one */
  operator?: ExpressionOperator;
  /** put this on the control, and it is already wired to a per-row label */
  controlId: string;
  /** the row-qualified accessible name, if the control needs it directly */
  label: string;
  /** id of the row's message element, for `aria-describedby` */
  describedBy?: string;
  /** the builder is read-only */
  disabled: boolean;
  /** picklist choices declared on the resource */
  options: SelectOption[];
  /** whether `condition.value` is a literal or another field's label path */
  valueKind: 'literal' | 'path';
  /** commit a new value for this row */
  setValue: (value: string) => void;
}

type FocusControl = 'row' | 'up' | 'down' | 'remove' | 'add';

interface FocusTarget {
  id: string;
  control: FocusControl;
}

interface BuilderRow {
  id: string;
  index: number;
  number: number;
  condition: ExpressionCondition;
  resource?: ExpressionResource;
  operatorSpec?: ExpressionOperator;
  operatorOptions: SelectOption[];
  needsValue: boolean;
  isPathValue: boolean;
  valueKindId: string;
  valueKindLabel: string;
  valueContext: ExpressionValueContext;
  menuItems: (MenuItemSpec | '---')[];
  legendId: string;
  resourceId: string;
  operatorId: string;
  valueId: string;
  messageId: string;
  message?: string;
  messageTone: 'error' | 'warning' | 'info';
  unused: boolean;
  isFirst: boolean;
  isLast: boolean;
  legendText: string;
  resourceLabel: string;
  operatorLabel: string;
  valueLabel: string;
  upLabel: string;
  downLabel: string;
  removeLabel: string;
  moreLabel: string;
  focusRow: boolean;
  focusUp: boolean;
  focusDown: boolean;
  focusRemove: boolean;
}

const LOGIC_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All conditions are met' },
  { value: 'any', label: 'Any condition is met' },
  { value: 'custom', label: 'Custom logic is met' },
  { value: 'always', label: 'Always (no conditions)' },
];

const VALUE_KIND_OPTIONS: SelectOption[] = [
  { value: 'literal', label: 'Value' },
  { value: 'path', label: 'Field' },
];

export interface ExpressionBuilderSignature {
  Args: {
    /** Controlled row list. Omit and seed `@defaultConditions` for the
     * uncontrolled path (kit contract: `args.value ?? internal`). */
    conditions?: ExpressionCondition[];
    /** Uncontrolled seed for the row list. */
    defaultConditions?: ExpressionCondition[];
    /** Controlled joiner: all / any / custom / always. */
    logic?: ExpressionLogic;
    /** Uncontrolled seed for the joiner. Default `all`. */
    defaultLogic?: ExpressionLogic;
    /** Controlled custom-logic string, e.g. `1 AND (2 OR 3)`. */
    customLogic?: string;
    /** Uncontrolled seed for the custom-logic string. */
    defaultCustomLogic?: string;
    /** Fields offered in the left column. Each carries the BXL label path it
     * writes verbatim into `targetPath` — quote it here if it needs quoting. */
    resources?: ExpressionResource[];
    /** Operator catalogue when a resource declares none and its type has no
     * default worth using. */
    operators?: ExpressionOperator[];
    /** Heading above the builder. Default `Conditions`. */
    title?: string;
    /** Label on the joiner select. Default `Take action when`. */
    logicLabel?: string;
    /** Singular noun for a row, used in every accessible name. Default
     * `Condition`. */
    conditionNoun?: string;
    /** Text on the add button. Default `Add condition`. */
    addLabel?: string;
    /** Refuse to add past this many rows. Unlimited when omitted. */
    maxConditions?: number;
    /** Offer a Value / Field switch on the right-hand side, so a condition
     * can compare two fields ("Total must not exceed the approved budget").
     * In `Field` mode the right side is a resource picker the builder owns —
     * the `<:value>` slot is only asked for literals. */
    allowFieldComparison?: boolean;
    /** Render every control disabled — the review/approved state. */
    readonly?: boolean;
    /** Authoring problems supplied by the caller, merged with the ones this
     * component derives. Rows are addressed by `conditionId`. */
    issues?: ExpressionIssue[];
    /** Fires after every structural or field change with the whole model. */
    onChange?: (model: ExpressionModel) => void;
    /** Fires alongside `@onChange` with the derived issue list, so a caller
     * can gate its save button without re-deriving them. */
    onIssues?: (issues: ExpressionIssue[]) => void;
  };
  Blocks: {
    /** The right-hand value control. Varies by operator and field type, so it
     * is a slot, not a string (Law 7). Falls back to a plain `Input`. */
    value: [ExpressionValueContext];
    /** Extra content between the joiner row and the rows. */
    header: [];
    /** Extra buttons beside `Add condition`. */
    footer: [];
  };
  Element: HTMLElement;
}

export class ExpressionBuilder extends Component<ExpressionBuilderSignature> {
  @tracked private internal: ExpressionModel = {
    logic: this.args.defaultLogic ?? 'all',
    customLogic: this.args.defaultCustomLogic ?? '',
    conditions: this.args.defaultConditions ?? [],
  };
  @tracked private focusTarget?: FocusTarget;
  @tracked announcement = '';

  private get uid() {
    return guidFor(this);
  }

  get conditions(): ExpressionCondition[] {
    return this.args.conditions ?? this.internal.conditions;
  }
  get logic(): ExpressionLogic {
    return this.args.logic ?? this.internal.logic;
  }
  get customLogic(): string {
    return this.args.customLogic ?? this.internal.customLogic ?? '';
  }
  get model(): ExpressionModel {
    return {
      logic: this.logic,
      customLogic: this.customLogic,
      conditions: this.conditions,
    };
  }
  get noun() {
    return this.args.conditionNoun ?? 'Condition';
  }
  get nounLower() {
    return this.noun.toLowerCase();
  }
  get title() {
    return this.args.title ?? 'Conditions';
  }
  get readonly() {
    return this.args.readonly ?? false;
  }
  get resources(): ExpressionResource[] {
    return this.args.resources ?? [];
  }
  get resourceOptions(): SelectOption[] {
    return this.resources.map((r) => ({ value: r.value, label: r.label }));
  }
  get logicOptions() {
    return LOGIC_OPTIONS;
  }
  get valueKindOptions() {
    return VALUE_KIND_OPTIONS;
  }
  get isCustom() {
    return this.logic === 'custom';
  }
  get isAlways() {
    return this.logic === 'always';
  }
  get atMax() {
    let max = this.args.maxConditions;
    return max !== undefined && this.conditions.length >= max;
  }
  get addLabel() {
    return this.args.addLabel ?? `Add ${this.nounLower}`;
  }
  private countPhrase(count: number) {
    return `${count} ${count === 1 ? this.nounLower : `${this.nounLower}s`}`;
  }
  get listLabel() {
    return `${this.title}, ${this.countPhrase(this.conditions.length)}`;
  }
  get countLabel() {
    return this.countPhrase(this.conditions.length);
  }
  get customLogicId() {
    return `${this.uid}-custom`;
  }
  get logicSelectId() {
    return `${this.uid}-logic`;
  }
  get focusAdd() {
    return this.focusTarget?.control === 'add';
  }

  /** Derive the issue list for an arbitrary model, so `@onIssues` can report
   * the state the caller is about to be handed rather than the one on screen. */
  issuesFor(model: ExpressionModel): ExpressionIssue[] {
    let derived: ExpressionIssue[] = [];
    if (model.logic !== 'always') {
      if (model.conditions.length === 0) {
        derived.push({
          severity: 'warning',
          message: `No ${this.nounLower}s yet — the rule will not compose until one is added.`,
        });
      }
      for (let i = 0; i < model.conditions.length; i++) {
        let condition = model.conditions[i]!;
        let number = i + 1;
        if (!condition.targetPath) {
          derived.push({
            severity: 'error',
            conditionId: condition.id,
            message: `${this.noun} ${number} has no field selected.`,
          });
        } else if (!condition.operator) {
          derived.push({
            severity: 'error',
            conditionId: condition.id,
            message: `${this.noun} ${number} has no operator selected.`,
          });
        } else if (
          conditionToBxl(condition, this.resources, this.args.operators) === ''
        ) {
          derived.push({
            severity: 'error',
            conditionId: condition.id,
            message: `${this.noun} ${number} has no value.`,
          });
        }
      }
      if (model.logic === 'custom') {
        derived = derived.concat(
          validateCustomLogic(model.customLogic, model.conditions.length),
        );
      }
    }
    return derived.concat(this.args.issues ?? []);
  }

  /** Issues this component derives, plus whatever the caller supplied. */
  get issues(): ExpressionIssue[] {
    return this.issuesFor(this.model);
  }

  get expressionIssues(): ExpressionIssue[] {
    return this.issues.filter((i) => !i.conditionId);
  }

  get hasErrors() {
    return this.issues.some((i) => i.severity === 'error');
  }

  /** Rows referenced at least once by the custom logic. Used to mark the
   * ones the author has stranded. */
  private get referenced(): Set<number> {
    let seen = new Set<number>();
    if (!this.isCustom) {
      return seen;
    }
    for (let token of tokenizeLogic(this.customLogic)) {
      if (token.kind === 'ref' && token.index !== undefined) {
        seen.add(token.index);
      }
    }
    return seen;
  }

  get rows(): BuilderRow[] {
    let conditions = this.conditions;
    let referenced = this.referenced;
    let issues = this.issues;
    let last = conditions.length - 1;
    let target = this.focusTarget;
    return conditions.map((condition, index) => {
      let number = index + 1;
      let resource = resourceFor(condition, this.resources);
      let catalogue = operatorCatalogue(resource, this.args.operators);
      let operatorSpec = operatorFor(condition, catalogue);
      let rowIssue = issues.find((i) => i.conditionId === condition.id);
      let base = `${this.uid}-r${condition.id}`;
      let valueId = `${base}-val`;
      let messageId = `${base}-msg`;
      let valueLabel = `${this.noun} ${number} value`;
      let isFirst = index === 0;
      let isLast = index === last;
      let valueKind = condition.valueKind ?? 'literal';
      return {
        id: condition.id,
        index,
        number,
        condition,
        resource,
        operatorSpec,
        operatorOptions: catalogue.map((o) => ({
          value: o.value,
          label: o.label,
        })),
        needsValue: operatorSpec?.arity !== 0,
        isPathValue: valueKind === 'path',
        valueKindId: `${base}-kind`,
        valueKindLabel: `${this.noun} ${number} value kind`,
        menuItems: [
          {
            label: 'Duplicate',
            disabled: this.readonly || this.atMax,
            onSelect: () => this.duplicateCondition(condition.id),
          },
          {
            label: 'Move to top',
            disabled: this.readonly || isFirst,
            onSelect: () => this.moveToTop(condition.id),
          },
          {
            label: 'Move to bottom',
            disabled: this.readonly || isLast,
            onSelect: () => this.moveToBottom(condition.id),
          },
        ],
        valueContext: {
          condition,
          index,
          number,
          resource,
          operator: operatorSpec,
          controlId: valueId,
          label: valueLabel,
          describedBy: rowIssue ? messageId : undefined,
          disabled: this.readonly,
          options: resource?.options ?? [],
          valueKind,
          setValue: (value: string) => this.setValue(condition.id, value),
        },
        legendId: `${base}-leg`,
        resourceId: `${base}-res`,
        operatorId: `${base}-op`,
        valueId,
        messageId,
        message: rowIssue?.message,
        messageTone: rowIssue?.severity ?? 'info',
        unused: this.isCustom && !referenced.has(number),
        isFirst,
        isLast,
        legendText: `${this.noun} ${number} of ${conditions.length}`,
        resourceLabel: `${this.noun} ${number} field`,
        operatorLabel: `${this.noun} ${number} operator`,
        valueLabel,
        upLabel: `Move ${this.nounLower} ${number} up`,
        downLabel: `Move ${this.nounLower} ${number} down`,
        removeLabel: `Remove ${this.nounLower} ${number}`,
        moreLabel: `More actions for ${this.nounLower} ${number}`,
        focusRow: target?.id === condition.id && target.control === 'row',
        focusUp: target?.id === condition.id && target.control === 'up',
        focusDown: target?.id === condition.id && target.control === 'down',
        focusRemove: target?.id === condition.id && target.control === 'remove',
      };
    });
  }

  get overflowItems(): (MenuItemSpec | '---')[] {
    return [
      {
        label: 'Rebuild custom logic from joiner',
        disabled: this.readonly || this.conditions.length === 0,
        onSelect: this.rebuildCustomLogic,
      },
      {
        label: 'Clear custom logic',
        disabled: this.readonly || this.customLogic === '',
        onSelect: this.clearCustomLogic,
      },
      '---',
      {
        label: `Remove all ${this.nounLower}s`,
        destructive: true,
        disabled: this.readonly || this.conditions.length === 0,
        onSelect: this.removeAll,
      },
    ];
  }

  // ── mutation ───────────────────────────────────────────────────────────

  private commit(next: ExpressionModel) {
    this.internal = next;
    this.args.onChange?.(next);
    this.args.onIssues?.(this.issuesFor(next));
  }

  /**
   * Commit a new row array and carry the custom logic across with it.
   *
   * The remap is derived from row IDS, not from the numbers: the old id at
   * position N is looked up in the new array, and its new position is the new
   * reference. Delete, move, duplicate and sort all reduce to this, which is
   * why none of them can renumber wrongly. A reference the old array never
   * had is passed through untouched so the validator reports it rather than
   * the editor quietly deleting the author's clause.
   */
  private commitRows(next: ExpressionCondition[], appendNumber?: number) {
    let before = this.conditions.map((c) => c.id);
    let after = next.map((c) => c.id);
    let custom = this.customLogic;
    if (custom.trim()) {
      custom = remapCustomLogic(custom, (index) => {
        let id = before[index - 1];
        if (id === undefined) {
          return index;
        }
        let position = after.indexOf(id);
        return position < 0 ? null : position + 1;
      });
    }
    if (appendNumber !== undefined && (custom.trim() || this.isCustom)) {
      custom = appendLogicRef(custom, appendNumber);
    }
    this.commit({ logic: this.logic, customLogic: custom, conditions: next });
  }

  private replace(id: string, patch: Partial<ExpressionCondition>) {
    let next = this.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c));
    this.commit({
      logic: this.logic,
      customLogic: this.customLogic,
      conditions: next,
    });
  }

  setLogic = (value: string) => {
    let logic = value as ExpressionLogic;
    let custom = this.customLogic;
    if (logic === 'custom' && !custom.trim()) {
      custom = seedCustomLogic(this.conditions.length, this.logic);
    }
    this.announcement =
      logic === 'custom'
        ? 'Custom logic enabled. Reference conditions by number.'
        : `Conditions combine with ${LOGIC_OPTIONS.find((o) => o.value === logic)?.label ?? logic}.`;
    this.commit({
      logic,
      customLogic: custom,
      conditions: this.conditions,
    });
  };

  setCustomLogic = (value: string) => {
    this.commit({
      logic: this.logic,
      customLogic: value,
      conditions: this.conditions,
    });
  };

  rebuildCustomLogic = () => {
    this.announcement = 'Custom logic rebuilt from the joiner.';
    this.commit({
      logic: 'custom',
      customLogic: seedCustomLogic(this.conditions.length, 'all'),
      conditions: this.conditions,
    });
  };

  clearCustomLogic = () => {
    this.announcement = 'Custom logic cleared.';
    this.commit({
      logic: this.logic,
      customLogic: '',
      conditions: this.conditions,
    });
  };

  setResource = (id: string, value: string) => {
    let resource = this.resources.find((r) => r.value === value);
    let catalogue = operatorCatalogue(resource, this.args.operators);
    let current = this.conditions.find((c) => c.id === id);
    // changing the field can invalidate the operator — keep it only when the
    // new catalogue still offers it, and never keep a value under a unary op
    let keep = catalogue.some((o) => o.value === current?.operator);
    this.replace(id, {
      targetPath: value,
      operator: keep ? current!.operator : (catalogue[0]?.value ?? ''),
      value: keep ? (current?.value ?? '') : '',
    });
  };

  setOperator = (id: string, value: string) => {
    let current = this.conditions.find((c) => c.id === id);
    let resource = current ? resourceFor(current, this.resources) : undefined;
    let catalogue = operatorCatalogue(resource, this.args.operators);
    let spec = catalogue.find((o) => o.value === value);
    this.replace(id, {
      operator: value,
      value: spec?.arity === 0 ? '' : (current?.value ?? ''),
    });
  };

  setValue = (id: string, value: string) => {
    this.replace(id, { value });
  };

  setValueKind = (id: string, kind: string) => {
    // switching sides discards the old right operand: a quoted literal is
    // never a valid label path and vice versa, and silently keeping it would
    // compose a rule that reads plausibly and means something else
    this.replace(id, {
      valueKind: kind === 'path' ? 'path' : 'literal',
      value: '',
    });
  };

  addCondition = () => {
    if (this.readonly || this.atMax) {
      return;
    }
    let created = newCondition();
    let next = [...this.conditions, created];
    this.focusTarget = { id: created.id, control: 'row' };
    this.announcement = `${this.noun} ${next.length} added. ${next.length} total.`;
    this.commitRows(next, next.length);
  };

  duplicateCondition = (id: string) => {
    if (this.readonly || this.atMax) {
      return;
    }
    let index = this.conditions.findIndex((c) => c.id === id);
    if (index < 0) {
      return;
    }
    let source = this.conditions[index]!;
    let created = newCondition({
      targetPath: source.targetPath,
      operator: source.operator,
      value: source.value,
    });
    let next = [...this.conditions];
    next.splice(index + 1, 0, created);
    this.focusTarget = { id: created.id, control: 'row' };
    this.announcement = `${this.noun} ${index + 1} duplicated as ${this.nounLower} ${index + 2}. ${next.length} total.`;
    this.commitRows(next, index + 2);
  };

  removeCondition = (id: string) => {
    if (this.readonly) {
      return;
    }
    let index = this.conditions.findIndex((c) => c.id === id);
    if (index < 0) {
      return;
    }
    let next = this.conditions.filter((c) => c.id !== id);
    // focus the row that took this one's place; the previous row when the
    // last row went; the add button when nothing is left
    let heir = next[index] ?? next[index - 1];
    this.focusTarget = heir
      ? { id: heir.id, control: 'remove' }
      : { id: 'add', control: 'add' };
    this.announcement = `${this.noun} ${index + 1} removed. ${next.length} remaining.`;
    this.commitRows(next);
  };

  removeAll = () => {
    if (this.readonly) {
      return;
    }
    this.focusTarget = { id: 'add', control: 'add' };
    this.announcement = `All ${this.nounLower}s removed.`;
    this.commitRows([]);
  };

  private move(id: string, delta: number, control: FocusControl) {
    if (this.readonly) {
      return;
    }
    let index = this.conditions.findIndex((c) => c.id === id);
    let to = index + delta;
    // never disable the end-of-list button — say why instead, so focus stays
    if (index < 0 || to < 0 || to >= this.conditions.length) {
      this.announcement = `${this.noun} ${index + 1} is already ${delta < 0 ? 'first' : 'last'}.`;
      return;
    }
    let next = [...this.conditions];
    let [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    this.focusTarget = { id, control };
    this.announcement = `${this.noun} moved to position ${to + 1} of ${next.length}.`;
    this.commitRows(next);
  }

  moveUp = (id: string) => this.move(id, -1, 'up');
  moveDown = (id: string) => this.move(id, 1, 'down');

  moveToTop = (id: string) => {
    let index = this.conditions.findIndex((c) => c.id === id);
    if (index <= 0) {
      return;
    }
    this.move(id, -index, 'row');
  };

  moveToBottom = (id: string) => {
    let index = this.conditions.findIndex((c) => c.id === id);
    let end = this.conditions.length - 1;
    if (index < 0 || index >= end) {
      return;
    }
    this.move(id, end - index, 'row');
  };

  <template>
    <section
      class='pretui-xb'
      data-readonly={{if this.readonly 'true'}}
      data-test-pretui-expression-builder
      ...attributes
    >
      <header class='xb-head'>
        <h3 class='xb-title' data-test-pretui-expression-title>{{this.title}}</h3>
        <Chip
          @label={{this.countLabel}}
          @dot={{false}}
          data-test-pretui-expression-count
        />
        <span class='xb-spacer'></span>
        <Menu @items={{this.overflowItems}} @align='end'>
          <:trigger as |open toggle|>
            <IconButton
              @label='{{this.title}} options'
              @variant='ghost'
              aria-expanded='{{open}}'
              aria-haspopup='menu'
              {{on 'click' toggle}}
              data-test-pretui-expression-overflow
            ><MoreIcon class='xb-icon' /></IconButton>
          </:trigger>
        </Menu>
      </header>

      <div class='xb-logic'>
        <label class='xb-label' for={{this.logicSelectId}}>
          {{if @logicLabel @logicLabel 'Take action when'}}
        </label>
        <Select
          @options={{this.logicOptions}}
          @value={{this.logic}}
          @controlId={{this.logicSelectId}}
          @disabled={{this.readonly}}
          @onValueChange={{this.setLogic}}
          class='xb-logic-select'
          data-test-pretui-expression-logic
        />
      </div>

      {{#if this.isCustom}}
        <div class='xb-custom'>
          <Field
            @label='Custom logic'
            @hint='Reference conditions by number — 1 AND (2 OR 3). NOT is allowed.'
          >
            <:default as |controlId|>
              <Input
                @value={{this.customLogic}}
                @controlId={{controlId}}
                @placeholder='1 AND (2 OR 3)'
                @disabled={{this.readonly}}
                @onInput={{this.setCustomLogic}}
                data-test-pretui-expression-custom
              />
            </:default>
          </Field>
        </div>
      {{/if}}

      {{yield to='header'}}

      {{#unless this.isAlways}}
        <div class='xb-cols' aria-hidden='true'>
          <span class='xb-col-num'>#</span>
          <span>Field</span>
          <span>Operator</span>
          <span>Value</span>
          <span></span>
        </div>

        <ol class='xb-rows' aria-label={{this.listLabel}}>
          {{#each this.rows key='id' as |row|}}
            <li class='xb-row-item'>
              {{! the fieldset+legend gives the row its group identity; the
                  tabindex makes it the landing spot after an insert, where the
                  legend is what gets announced }}
              <fieldset
                class='xb-row'
                tabindex='-1'
                data-unused={{if row.unused 'true'}}
                data-invalid={{if row.message 'true'}}
                data-test-pretui-expression-row={{row.number}}
                {{focusWhen row.focusRow}}
              >
                {{! the visible number lives in the grid, so the legend can be
                    purely the row's spoken identity — no float, no duplicate
                    announcement of the digit }}
                <legend id={{row.legendId}} class='pretui-sr'>
                  {{row.legendText}}
                </legend>

                <div class='xb-grid'>
                  <span class='xb-num' aria-hidden='true'>{{row.number}}</span>
                  <div class='xb-cell'>
                    <label class='pretui-sr' for={{row.resourceId}}>
                      {{row.resourceLabel}}
                    </label>
                    <Select
                      @options={{this.resourceOptions}}
                      @value={{row.condition.targetPath}}
                      @controlId={{row.resourceId}}
                      @placeholder='Select field…'
                      @disabled={{this.readonly}}
                      @onValueChange={{fn this.setResource row.id}}
                      data-test-pretui-expression-resource={{row.number}}
                    />
                  </div>

                  <div class='xb-cell xb-cell-op'>
                    <label class='pretui-sr' for={{row.operatorId}}>
                      {{row.operatorLabel}}
                    </label>
                    <Select
                      @options={{row.operatorOptions}}
                      @value={{row.condition.operator}}
                      @controlId={{row.operatorId}}
                      @placeholder='Operator…'
                      @disabled={{this.readonly}}
                      @onValueChange={{fn this.setOperator row.id}}
                      data-test-pretui-expression-operator={{row.number}}
                    />
                  </div>

                  <div class='xb-cell xb-cell-value'>
                    {{#if row.needsValue}}
                      {{#if @allowFieldComparison}}
                        <label class='pretui-sr' for={{row.valueKindId}}>
                          {{row.valueKindLabel}}
                        </label>
                        <Select
                          @options={{this.valueKindOptions}}
                          @value={{if row.isPathValue 'path' 'literal'}}
                          @controlId={{row.valueKindId}}
                          @disabled={{this.readonly}}
                          @onValueChange={{fn this.setValueKind row.id}}
                          class='xb-kind'
                          data-test-pretui-expression-value-kind={{row.number}}
                        />
                      {{/if}}
                      <label class='pretui-sr' for={{row.valueId}}>
                        {{row.valueLabel}}
                      </label>
                      {{#if row.isPathValue}}
                        <Select
                          @options={{this.resourceOptions}}
                          @value={{row.condition.value}}
                          @controlId={{row.valueId}}
                          @placeholder='Compare with field…'
                          @disabled={{this.readonly}}
                          @onValueChange={{fn this.setValue row.id}}
                          data-test-pretui-expression-value={{row.number}}
                        />
                      {{else if (has-block 'value')}}
                        {{yield row.valueContext to='value'}}
                      {{else}}
                        <Input
                          @value={{row.condition.value}}
                          @controlId={{row.valueId}}
                          @placeholder='Value'
                          @disabled={{this.readonly}}
                          @onInput={{fn this.setValue row.id}}
                          aria-describedby={{row.messageId}}
                          data-test-pretui-expression-value={{row.number}}
                        />
                      {{/if}}
                    {{else}}
                      <span class='xb-novalue'>No value needed</span>
                    {{/if}}
                  </div>

                  <div class='xb-cell xb-cell-actions'>
                    <ButtonGroup @label='{{this.noun}} {{row.number}} actions'>
                      <IconButton
                        @label={{row.upLabel}}
                        @variant='ghost'
                        aria-disabled='{{row.isFirst}}'
                        disabled={{this.readonly}}
                        {{on 'click' (fn this.moveUp row.id)}}
                        {{focusWhen row.focusUp}}
                        data-test-pretui-expression-up={{row.number}}
                      ><MoveIcon class='xb-icon xb-flip' /></IconButton>
                      <IconButton
                        @label={{row.downLabel}}
                        @variant='ghost'
                        aria-disabled='{{row.isLast}}'
                        disabled={{this.readonly}}
                        {{on 'click' (fn this.moveDown row.id)}}
                        {{focusWhen row.focusDown}}
                        data-test-pretui-expression-down={{row.number}}
                      ><MoveIcon class='xb-icon' /></IconButton>
                      <IconButton
                        @label={{row.removeLabel}}
                        @variant='ghost'
                        disabled={{this.readonly}}
                        {{on 'click' (fn this.removeCondition row.id)}}
                        {{focusWhen row.focusRemove}}
                        data-test-pretui-expression-remove={{row.number}}
                      ><RemoveIcon class='xb-icon' /></IconButton>
                    </ButtonGroup>
                    <Menu @items={{row.menuItems}} @align='end'>
                      <:trigger as |open toggle|>
                        <IconButton
                          @label={{row.moreLabel}}
                          @variant='ghost'
                          aria-expanded='{{open}}'
                          aria-haspopup='menu'
                          {{on 'click' toggle}}
                          data-test-pretui-expression-more={{row.number}}
                        ><MoreIcon class='xb-icon' /></IconButton>
                      </:trigger>
                    </Menu>
                  </div>
                </div>

                {{! The severity notation: the state's own NAME is the mark,
                    set in the eyebrow treatment in a fixed gutter. It is not
                    aria-hidden — a word is information, and a field pointing
                    here through aria-describedby should hear "error" before
                    the message. Two notes stack as two grid rows. }}
                <p class='xb-msg' id={{row.messageId}} data-tone={{row.messageTone}}>
                  {{#if row.message}}
                    <span class='xb-note-mark' data-tone={{row.messageTone}}>
                      {{row.messageTone}}
                    </span>
                    <span class='xb-note-body'>{{row.message}}</span>
                  {{/if}}
                  {{#if row.unused}}
                    <span class='xb-note-mark' data-tone='warning'>note</span>
                    <span class='xb-note-body'>Not referenced by the custom
                      logic.</span>
                  {{/if}}
                </p>
              </fieldset>
            </li>
          {{/each}}
        </ol>

        <div class='xb-foot'>
          <Button
            @variant='secondary'
            @disabled={{if this.readonly true this.atMax}}
            {{on 'click' this.addCondition}}
            {{focusWhen this.focusAdd}}
            data-test-pretui-expression-add
          ><AddIcon class='xb-icon' />{{this.addLabel}}</Button>
          {{yield to='footer'}}
        </div>
      {{/unless}}

      {{#if this.expressionIssues}}
        <ul class='xb-issues' data-test-pretui-expression-issues>
          {{#each this.expressionIssues as |issue|}}
            <li class='xb-issue' data-tone={{issue.severity}}>
              <span class='xb-note-mark' data-tone={{issue.severity}}>
                {{issue.severity}}
              </span>
              <span class='xb-note-body'>{{issue.message}}</span>
            </li>
          {{/each}}
        </ul>
      {{/if}}

      <p class='pretui-sr' role='status'>{{this.announcement}}</p>

    </section>
    <style scoped>
      /* above Select's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-xb {
          container-type: inline-size;
          display: block;
          color: var(--foreground);
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          --pretui-xb-gap: var(--space-3, 8px);
          --pretui-xb-num-w: 20px;
          --pretui-xb-op-w: 9.5rem;
          --pretui-xb-actions-w: max-content;
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        .xb-head {
          display: flex;
          align-items: center;
          gap: var(--pretui-xb-gap);
          margin-bottom: var(--space-3, 8px);
        }
        .xb-title {
          margin: 0;
          font-size: var(--text-ui-lg, 13.5px);
          font-weight: 600;
          letter-spacing: var(--track-heading, -0.01em);
        }
        .xb-spacer {
          flex: 1;
        }
        .xb-icon {
          --icon-color: currentColor;
          width: 13px;
          height: 13px;
          flex: none;
        }
        .xb-flip {
          transform: rotate(180deg);
        }
        .xb-logic {
          display: flex;
          align-items: center;
          gap: var(--pretui-xb-gap);
          flex-wrap: wrap;
        }
        .xb-label {
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          color: var(--muted-foreground);
        }
        .xb-logic-select {
          min-width: 14rem;
        }
        .xb-custom {
          margin-top: var(--space-3, 8px);
          max-width: 32rem;
        }
        .xb-cols {
          display: grid;
          grid-template-columns:
            var(--pretui-xb-num-w) minmax(0, 1fr) var(--pretui-xb-op-w)
            minmax(0, 1fr) var(--pretui-xb-actions-w);
          gap: var(--pretui-xb-gap);
          margin-top: var(--space-4, 11px);
          padding-inline: 2px;
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: var(--track-eyebrow, 0.06em);
          color: var(--muted-foreground);
        }
        .xb-col-num {
          text-align: center;
        }
        .xb-rows {
          list-style: none;
          margin: 4px 0 0;
          padding: 0;
        }
        .xb-row-item + .xb-row-item {
          margin-top: 4px;
        }
        .xb-row {
          border: 0;
          margin: 0;
          padding: 4px 2px;
          border-radius: var(--radius);
          min-inline-size: 0;
        }
        .xb-row:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* No state stripe on the row. Both states already carry a written
           message below the grid, and the stripe added a SECOND channel that
           only worked in colour on top of a first that always works — invalid
           and unused were told apart by hue and nothing else, so they were the
           same 2px grey rule in greyscale. The notation below carries both. */
        .xb-num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: var(--pretui-xb-num-w);
          height: var(--control-h, 28px);
          font-variant-numeric: tabular-nums;
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .xb-grid {
          display: grid;
          grid-template-columns:
            var(--pretui-xb-num-w) minmax(0, 1fr) var(--pretui-xb-op-w)
            minmax(0, 1fr) var(--pretui-xb-actions-w);
          gap: var(--pretui-xb-gap);
          align-items: center;
        }
        .xb-cell {
          min-width: 0;
        }
        .xb-cell-value {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .xb-cell-value > :last-child {
          flex: 1;
          min-width: 0;
        }
        .xb-kind {
          flex: none;
          width: 5.5rem;
        }
        .xb-cell-actions {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .xb-novalue {
          display: inline-flex;
          align-items: center;
          height: var(--control-h, 28px);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        /* ── The severity notation ───────────────────────────────────────────
           One treatment, used everywhere this component reports a state. It
           replaces three colour-only treatments that were here before: a
           tinted rule down the inline start of the row, a tinted rule down
           the issue list, and a message printed entirely in its severity hue.

           Severity is TYPESET. The state's own name is the mark, set in the
           kit's eyebrow treatment against a fixed gutter so a stack of notes
           aligns like a table of contents. Three channels, in priority order:

             1. the WORD — survives greyscale, a photocopy and a screen reader,
                and is the only channel that still says which severity it is
                when the hue is gone;
             2. the GUTTER — identical width for every severity, so it is
                alignment rather than signal; it is what makes a stack read as
                one list, and it is why no rule or box is needed to group them;
             3. the HUE — on the mark ALONE. Delete colour and nothing is lost.

           There is deliberately no tone→glyph map. The map only ever converted
           a word this component already had into a decoration that said less.

           The message itself is --foreground at full contrast rather than
           tinted, which is also the contrast fix: 11.5px --destructive text on
           --card was this file's thinnest AA margin, in both modes and every
           season. Tinting a whole sentence never made it more legible. */
        .xb-msg,
        .xb-issue {
          display: grid;
          grid-template-columns: var(--pretui-xb-notegutter, 5.25em) minmax(0, 1fr);
          column-gap: var(--space-2, 6px);
          row-gap: 2px;
          align-items: baseline;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--foreground);
        }
        .xb-msg {
          margin: 2px 0 0 calc(var(--pretui-xb-num-w) + var(--pretui-xb-gap));
          min-height: 1em;
        }
        .xb-note-mark {
          justify-self: end;
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          white-space: nowrap;
          color: var(--muted-foreground);
        }
        /* The hue is ANCHORED IN INK, never used raw. --warning as text is
           about 2:1 on --card in SS26 — the whole-message tint this replaces
           failed AA outright, and a bold 11px mark would fail it too. Mixing
           toward --foreground rather than toward a fixed dark is what makes it
           mode-correct for free (Law 2's crossover argument): --foreground is
           near-black on a light card and near-white on a dark one, so the same
           declaration lands on a dark amber in light mode and a light amber in
           dark mode, in every season, with no dark branch. */
        .xb-note-mark[data-tone='error'] {
          color: color-mix(
            in oklch,
            var(--destructive) var(--pretui-note-hue-mix, 45%),
            var(--foreground)
          );
        }
        .xb-note-mark[data-tone='warning'] {
          color: color-mix(
            in oklch,
            var(--warning, var(--boxel-warning)) var(--pretui-note-hue-mix, 45%),
            var(--foreground)
          );
        }
        .xb-note-body {
          min-width: 0;
        }
        .xb-foot {
          display: flex;
          align-items: center;
          gap: var(--pretui-xb-gap);
          margin-top: var(--space-3, 8px);
        }
        .xb-issues {
          list-style: none;
          margin: var(--space-3, 8px) 0 0;
          padding: 0;
          display: grid;
          gap: 3px;
        }
        /* .xb-issue wears the same notation as .xb-msg (grid declared above).
           It keeps no box of its own: a rounded 2px-striped slab per issue was
           a container for one line of text that needed no container. */
        /* unnamed container query — resolves against .pretui-xb, the nearest
           ancestor container, so these rules never target the container itself */
        @container (max-width: 44rem) {
          .xb-cols {
            display: none;
          }
          .xb-grid {
            grid-template-columns: var(--pretui-xb-num-w) minmax(0, 1fr);
            align-items: start;
          }
          .xb-num {
            grid-row: 1 / span 4;
            align-self: start;
          }
          .xb-row {
            padding-block: 6px;
            box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          }
          /* the narrow cut stacks the notation instead of gutter-aligning it,
             because 5.25em of gutter is a third of the pane at this width */
          .xb-msg,
          .xb-issue {
            grid-template-columns: minmax(0, 1fr);
            row-gap: 0;
          }
          .xb-note-mark {
            justify-self: start;
          }
        }
      }
    </style>
  </template>
}
