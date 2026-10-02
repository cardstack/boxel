// Pretui — PropertySheet: a sheet of ValueInputs driven by a spec list.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { PropertyRow } from './property-row';
import type { PropertyRowSignature } from './property-row';
import { ValueInput } from './value-input';
import type { ValueKind, ValueOf, ValueSpec } from './value-input';

// ═══════════════════════════════════════════════════════════════════════
// PropertySheet
// ═══════════════════════════════════════════════════════════════════════

export interface PropertySheetSignature {
  Args: {
    /** the rows, in order */
    specs: ValueSpec[];
    /** current values, keyed by `spec.key` */
    values: Record<string, ValueOf>;
    /** default row layout (each spec may override) */
    layout?: PropertyRowSignature['Args']['layout'];
    disabled?: boolean;
    onChange?: (key: string, value: ValueOf) => void;
    /** invoked by a row's reset control; the row only shows one when the
     * spec is `modified` AND this is supplied */
    onReset?: (key: string) => void;
  };
  Blocks: {
    custom: [ValueKind, ValueOf, ValueSpec, boolean];
  };
  Element: HTMLDivElement;
}

/**
 * A property panel rendered from data.
 *
 * The point is not brevity — it is that a panel defined as `ValueSpec[]` can
 * come from a card schema, a plugin manifest or a diffing multi-selection,
 * and still get every affordance the hand-written rows have: labels wired to
 * controls, hints wired to `aria-describedby`, mixed state as text, reset
 * where a value differs from its default, and the container-query fold.
 */
export const PropertySheet: TemplateOnlyComponent<PropertySheetSignature> = <template>
    <div class='pretui-sheet' data-test-pretui-property-sheet ...attributes>
      {{#each @specs key='key' as |spec|}}
        <PropertySheetRow
          @spec={{spec}}
          @value={{get @values spec.key}}
          @layout={{if spec.layout spec.layout @layout}}
          @disabled={{@disabled}}
          @onChange={{@onChange}}
          @onReset={{@onReset}}
        >
          <:custom as |kind value disabled|>
            {{yield kind value spec disabled to='custom'}}
          </:custom>
        </PropertySheetRow>
      {{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-sheet {
          display: grid;
          gap: 1px;
          min-width: 0;
        }
      }
    </style>
</template>;

/** Index into the values record without a helper import. */
function get(record: Record<string, ValueOf> | undefined, key: string): ValueOf {
  return record ? record[key] : undefined;
}

// ── One sheet row ────────────────────────────────────────────────────────
// A child component so each row owns stable bound handlers. `(fn this.emit
// spec.key)` inside the loop would allocate a fresh closure every render,
// which is the modifier-retracking trap the workspace learnings document.

interface PropertySheetRowSignature {
  Args: {
    spec: ValueSpec;
    value: ValueOf;
    layout?: PropertyRowSignature['Args']['layout'];
    disabled?: boolean;
    onChange?: (key: string, value: ValueOf) => void;
    onReset?: (key: string) => void;
  };
  Blocks: { custom: [ValueKind, ValueOf, boolean] };
  Element: HTMLDivElement;
}

class PropertySheetRow extends Component<PropertySheetRowSignature> {
  get disabled(): boolean {
    return this.args.disabled || this.args.spec.disabled || false;
  }
  get resettable(): (() => void) | undefined {
    return this.args.onReset ? this.reset : undefined;
  }
  change = (value: ValueOf) => {
    this.args.onChange?.(this.args.spec.key, value);
  };
  reset = () => {
    this.args.onReset?.(this.args.spec.key);
  };
  <template>
    <PropertyRow
      @label={{@spec.label}}
      @hint={{@spec.hint}}
      @layout={{@layout}}
      @mixed={{@spec.mixed}}
      @modified={{@spec.modified}}
      @disabled={{this.disabled}}
      @onReset={{this.resettable}}
      ...attributes
      as |controlId hintId|
    >
      <ValueInput
        @kind={{@spec.kind}}
        @value={{@value}}
        @spec={{@spec}}
        @controlId={{controlId}}
        @describedBy={{hintId}}
        @disabled={{this.disabled}}
        @onChange={{this.change}}
      >
        <:custom as |kind value disabled|>
          {{yield kind value disabled to='custom'}}
        </:custom>
      </ValueInput>
    </PropertyRow>
  </template>
}
