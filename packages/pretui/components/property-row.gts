// Pretui — PropertyRow: the property-panel atom, a label and its control in one row.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';

// ═══════════════════════════════════════════════════════════════════════
// PropertyRow — the atom (fig-field)
// ═══════════════════════════════════════════════════════════════════════

export interface PropertyRowSignature {
  Args: {
    /** the property name, shown in the label column */
    label?: string;
    /** short explanation; rendered under the control, and referenced by
     * `aria-describedby` on whatever the caller wires `controlId` to */
    hint?: string;
    /** 'row' (default) puts the label in a fixed left column — the dense
     * inspector shape. 'stack' puts it above. 'split' gives label and
     * control equal halves. */
    layout?: 'row' | 'stack' | 'split';
    /** width of the label column in `row` layout; any CSS length */
    labelWidth?: string;
    /** true when the selection holds more than one value for this property.
     * Rendered as the WORD "Mixed" beside the label, never as colour or a
     * bare dash — Appendix L's "state is never colour alone". */
    mixed?: boolean;
    /** true when the value differs from its default: reveals the reset
     * control. Without `@onReset` the dot is informational only. */
    modified?: boolean;
    /** invoked by the reset control */
    onReset?: () => void;
    /** dims the row (`data-disabled`); the control itself is the
     * caller's to disable */
    disabled?: boolean;
  };
  Blocks: {
    /** the control(s). Yields the id to put on the control so the label
     * points at it, and the id of the hint for `aria-describedby`. */
    default: [controlId: string, hintId: string];
    /** replaces the plain text label — for a label that is itself a
     * control (a scrub grip, a units toggle) */
    label: [controlId: string];
    /** trailing affordances: a link/unlink toggle, an overflow menu */
    actions: [];
  };
  Element: HTMLDivElement;
}

/**
 * The inspector row: a property name, its control, and the two states a
 * property panel cannot work without — MIXED (multi-selection) and MODIFIED
 * (differs from default, offering a reset).
 *
 * **Why this is not `Field`.** `controls.gts`'s `Field` is the FORM field:
 * label above, control below, and a permanently reserved message line so a
 * row of side-by-side inputs never shifts when validation appears. Those
 * are exactly the wrong properties for an inspector, where rows are dense,
 * the label lives in a fixed left column, and vertical space is the scarce
 * resource. `PropertyRow` also carries mixed/modified/reset, which are
 * inspector concepts with no meaning in a form. Use `Field` in forms and
 * `PropertyRow` in panels; `PropertyRow @layout='stack'` is the closest the
 * two come to each other.
 */
export class PropertyRow extends Component<PropertyRowSignature> {
  private guid = guidFor(this);
  get controlId(): string {
    return this.guid + '-ctl';
  }
  get hintId(): string {
    return this.guid + '-hint';
  }
  get labelStyle() {
    // Caller strings never reach CSS unescaped: only a whitelist of length
    // characters survives, so `@labelWidth` cannot inject a declaration.
    let raw = this.args.labelWidth ?? '';
    let safe = /^[0-9a-zA-Z.%() +-]{0,32}$/.test(raw) ? raw : '';
    return safe ? htmlSafe('--pretui-property-label-w: ' + safe) : undefined;
  }
  get resetLabel(): string {
    return this.args.label ? 'Reset ' + this.args.label : 'Reset to default';
  }
  handleReset = () => {
    this.args.onReset?.();
  };
  <template>
    <div
      class='pretui-property'
      data-layout={{if @layout @layout 'row'}}
      data-mixed={{if @mixed 'true'}}
      data-modified={{if @modified 'true'}}
      data-disabled={{if @disabled 'true'}}
      style={{this.labelStyle}}
      data-test-pretui-property-row
      ...attributes
    >
      <div class='pretui-property-name'>
        {{#if (has-block 'label')}}
          {{yield this.controlId to='label'}}
        {{else if @label}}
          <label for={{this.controlId}}>{{@label}}</label>
        {{/if}}
        {{#if @mixed}}
          <span class='pretui-property-mixed' data-test-pretui-property-mixed>Mixed</span>
        {{/if}}
      </div>

      <div class='pretui-property-control'>
        {{yield this.controlId this.hintId}}
      </div>

      <div class='pretui-property-tail'>
        {{#if (has-block 'actions')}}{{yield to='actions'}}{{/if}}
        {{#if @modified}}
          {{#if @onReset}}
            <button
              type='button'
              class='pretui-property-reset'
              aria-label={{this.resetLabel}}
              {{on 'click' this.handleReset}}
              data-test-pretui-property-reset
            >
              <svg
                width='11'
                height='11'
                viewBox='0 0 12 12'
                aria-hidden='true'
                focusable='false'
              ><path
                  d='M2.5 6a3.5 3.5 0 1 0 1.1-2.55M3 2v2h2'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.2'
                  stroke-linecap='round'
                  stroke-linejoin='round'
                /></svg>
            </button>
          {{else}}
            <span
              class='pretui-property-dot'
              title='Changed from default'
              data-test-pretui-property-dot
            ><span class='pretui-sr'>Changed from default</span></span>
          {{/if}}
        {{/if}}
      </div>

      {{#if @hint}}
        <p class='pretui-property-hint' id={{this.hintId}}>{{@hint}}</p>
      {{/if}}
    </div>
    <style scoped>
      .pretui-property {
        --pretui-property-label-w: 84px;
        display: grid;
        grid-template-columns: var(--pretui-property-label-w) minmax(0, 1fr) auto;
        grid-template-areas: 'name control tail' '. hint hint';
        align-items: center;
        column-gap: var(--space-3, 8px);
        row-gap: 2px;
        min-height: var(--control-h, 28px);
        padding-block: 1px;
        font-size: var(--text-ui, 12px);
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--foreground);
      }
      .pretui-property[data-layout='stack'] {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas: 'name tail' 'control control' 'hint hint';
        align-items: start;
        row-gap: 4px;
      }
      .pretui-property[data-layout='split'] {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
      }
      .pretui-property[data-disabled='true'] {
        opacity: 0.45;
      }
      .pretui-property-name {
        grid-area: name;
        display: flex;
        align-items: baseline;
        gap: 5px;
        min-width: 0;
      }
      .pretui-property-name > label {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
        color: var(--muted-foreground);
        cursor: default;
      }
      .pretui-property-control {
        grid-area: control;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
      }
      .pretui-property-control > * {
        min-width: 0;
      }
      .pretui-property-tail {
        grid-area: tail;
        display: flex;
        align-items: center;
        gap: 2px;
        /* The reset control is revealed by hover/focus but must never be
           the ONLY way to reach it: it stays in the tab order and becomes
           fully opaque on :focus-visible, and on a coarse pointer it is
           always visible (see the pointer query below). */
        opacity: 0;
        transition: opacity var(--pretui-dur-snap, 160ms)
          var(--pretui-ease-snap, ease);
      }
      .pretui-property:hover .pretui-property-tail,
      .pretui-property:focus-within .pretui-property-tail,
      .pretui-property[data-mixed='true'] .pretui-property-tail {
        opacity: 1;
      }
      .pretui-property-hint {
        grid-area: hint;
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--ink-3, var(--boxel-400));
      }
      .pretui-property-mixed {
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-eyebrow, 0.04em);
        color: var(--muted-foreground);
        background: var(--field, var(--boxel-light));
        border-radius: var(--radius-sm, 5px);
        padding: 0 4px;
      }
      .pretui-property-reset {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: var(--radius-sm, 5px);
        background: transparent;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-property-reset:hover {
        background: var(--hover, rgb(0 0 0 / 0.05));
        color: var(--foreground);
      }
      .pretui-property-reset:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .pretui-property-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        margin: 0 7px;
        border-radius: 50%;
        background: var(--primary);
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      /* Touch: hover-reveal is meaningless, and 20px is under the 44px
         floor, so the tail is always visible and the hit area grows. */
      @media (pointer: coarse) {
        .pretui-property-tail {
          opacity: 1;
        }
        .pretui-property-reset {
          width: 32px;
          height: 32px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-property-tail {
          transition: none;
        }
      }
      /* Narrow panes fold the label above the control. Unnamed container
         query only — a named one silently deletes every rule after it. */
      @container (max-width: 240px) {
        .pretui-property,
        .pretui-property[data-layout='split'] {
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas: 'name tail' 'control control' 'hint hint';
          align-items: start;
          row-gap: 4px;
        }
      }
    </style>
  </template>
}
