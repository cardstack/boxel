// Pretui — FormLayout: the grid a Form lays its fields and sections into.
import Component from '@glimmer/component';
import { hash } from '@ember/helper';
import { FormField } from './form-field';
import type { FormSectionRegistry } from './form-field';
import { FormSection } from './form-section';
import { FormContext } from '../internal/forms-core';

// ── FormLayout ───────────────────────────────────────────────────────────
// SLDS's `.slds-form` (`_stacked` / `_horizontal`) plus `slds-form__row` /
// `slds-form__item`, as one grid.
//
// Better than the inspiration: SLDS breaks its columns on
// `@media (min-width: 48em)` — the VIEWPORT — so a two-column form in a
// 320px side panel of a 1600px window stays two columns and shreds. Ours
// measures the pane with an unnamed container query. (Named container
// queries are forbidden in realm code: the scoped-CSS transpiler silently
// drops every rule after one, so a single `@container name (...)` would
// delete the rest of this stylesheet with no error anywhere.)
//
// Note the container-query subtlety this markup exists to satisfy: an
// unnamed query resolves against the nearest ANCESTOR container, so a rule
// inside one can never match the container element itself. Hence the outer
// `.pretui-formlayout` (the container) wrapping the inner
// `.pretui-formlayout-grid` (what the queries actually restyle).

/* eslint-disable @typescript-eslint/no-explicit-any -- curried contextual
   components, any-typed exactly as in freestyle.gts's Args hash */
export interface FormLayoutApi {
  /** FormField, pre-curried with the form context and this direction. */
  Field: any;
  /** FormSection, pre-curried with the form context. A section is a grid
   *  item and spans every column by default. */
  Section: any;
  direction: 'stacked' | 'horizontal';
  columns: number;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface FormLayoutSignature {
  Args: {
    /** 'stacked' puts labels above controls; 'horizontal' puts them beside,
     *  and curries that into the yielded Field. */
    direction?: 'stacked' | 'horizontal';
    /** 1 or 2 (3 is allowed and collapses in two steps). Columns collapse to
     *  one below the container breakpoint. */
    columns?: number;
    /** Label column width in the horizontal direction. Default 9rem. */
    labelWidth?: string;
    /** Gap between fields. Default var(--space-5, 14px). */
    gap?: string;
    /** The owning form's context — passed straight through to the yielded
     *  Field. Supplied automatically by `form.Layout`. */
    form?: FormContext;
    /** The enclosing FormSection, passed through so fields laid out inside a
     *  section still count toward that section's issue badge. Supplied
     *  automatically by `section.Layout`. */
    section?: FormSectionRegistry;
  };
  Blocks: { default: [FormLayoutApi] };
  Element: HTMLDivElement;
}

export class FormLayout extends Component<FormLayoutSignature> {
  get direction(): 'stacked' | 'horizontal' {
    return this.args.direction ?? 'stacked';
  }
  get columns(): number {
    return this.args.columns ?? 1;
  }
  get columnsAttr(): string {
    return String(this.columns);
  }
  <template>
    <div
      class='pretui-formlayout'
      data-direction={{this.direction}}
      data-columns={{this.columnsAttr}}
      data-test-pretui-form-layout
      ...attributes
    >
      <div class='pretui-formlayout-grid' data-columns={{this.columnsAttr}}>
        {{yield
          (hash
            Field=(component
              FormField form=@form section=@section layout=this.direction
            )
            Section=(component FormSection form=@form)
            direction=this.direction
            columns=this.columns
          )
        }}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-formlayout {
          /* UNNAMED container only — see the module note. */
          container-type: inline-size;
          min-width: 0;
          --pretui-field-label-width: var(--pretui-formlayout-label-width, 9rem);
        }
        .pretui-formlayout-grid {
          display: grid;
          gap: var(--pretui-formlayout-gap, var(--space-5, 14px));
          align-content: start;
          min-width: 0;
        }
        .pretui-formlayout-grid[data-columns='2'] {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .pretui-formlayout-grid[data-columns='3'] {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        /* Two collapse steps, measured against the PANE. */
        @container (max-width: 52rem) {
          .pretui-formlayout-grid[data-columns='3'] {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @container (max-width: 34rem) {
          .pretui-formlayout-grid[data-columns='2'],
          .pretui-formlayout-grid[data-columns='3'] {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      }
    </style>
  </template>
}
