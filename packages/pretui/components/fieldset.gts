// Pretui — Fieldset: a real <fieldset> with a <legend>. Disabling it
// disables every control inside through the platform, and the legend is the
// group's accessible name. FormSection is the form-aware region with issue
// counts and a disclosure; this is the thin primitive it stands on.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { firstDefined } from '../pretui-primitives';

export type FieldsetOrientation = 'vertical' | 'horizontal';

export interface FieldsetSignature {
  Args: {
    /** the group's name; sugar for <:legend> */
    legend?: string;
    /** prose under the legend, wired to the group with aria-describedby */
    description?: string;
    /** native fieldset disabling — every control inside goes inert */
    disabled?: boolean;
    /** alias — React Aria / Base UI spelling of @disabled */
    isDisabled?: boolean;
    /** keep the legend for assistive tech but do not paint it */
    hideLegend?: boolean;
    /** `vertical` (default) stacks the controls; `horizontal` flows them in a row */
    orientation?: FieldsetOrientation;
  };
  Blocks: {
    /** the legend, when it needs markup; wins over @legend */
    legend: [];
    /** the controls */
    default: [];
  };
  Element: HTMLFieldSetElement;
}

export class Fieldset extends Component<FieldsetSignature> {
  descId = `${guidFor(this)}-desc`;
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get orientation(): FieldsetOrientation {
    return this.args.orientation ?? 'vertical';
  }
  <template>
    <fieldset
      class='pretui-fieldset'
      data-orientation={{this.orientation}}
      disabled={{this.disabled}}
      aria-describedby={{if @description this.descId}}
      data-test-pretui-fieldset
      ...attributes
    >
      {{#if (has-block 'legend')}}
        <legend class='pretui-fieldset-legend' data-hidden={{if @hideLegend 'true' 'false'}}>
          {{yield to='legend'}}
        </legend>
      {{else if @legend}}
        <legend class='pretui-fieldset-legend' data-hidden={{if @hideLegend 'true' 'false'}}>
          {{@legend}}
        </legend>
      {{/if}}
      {{#if @description}}
        <p class='pretui-fieldset-desc' id={{this.descId}}>{{@description}}</p>
      {{/if}}
      <div class='pretui-fieldset-body'>{{yield}}</div>
    </fieldset>
    <style scoped>
      @layer PretComponent {
        .pretui-fieldset {
          --fs-gap: var(--space-3, 0.5rem);
          --fs-text: var(--text-ui-md, 0.78rem);
          --fs-small: var(--text-ui-sm, 0.72rem);
          --fs-strong: var(--weight-strong, 600);
          margin: 0;
          padding: 0;
          border: 0;
          min-inline-size: 0;
          display: flex;
          flex-direction: column;
          gap: var(--fs-gap);
          font-size: var(--fs-text);
        }
        .pretui-fieldset-legend {
          margin: 0;
          padding: 0;
          font-weight: var(--fs-strong);
          color: var(--foreground);
        }
        /* a <legend> is laid out outside the flex flow, so its spacing is its own */
        .pretui-fieldset-legend + .pretui-fieldset-desc,
        .pretui-fieldset-legend + .pretui-fieldset-body {
          margin-block-start: calc(var(--fs-gap) * 0.75);
        }
        .pretui-fieldset-legend[data-hidden='true'] {
          position: absolute;
          inline-size: 1px;
          block-size: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-fieldset-desc {
          margin: 0;
          font-size: var(--fs-small);
          color: var(--muted-foreground);
        }
        .pretui-fieldset-body {
          display: flex;
          flex-direction: column;
          gap: var(--fs-gap);
          min-inline-size: 0;
        }
        .pretui-fieldset[data-orientation='horizontal'] .pretui-fieldset-body {
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          column-gap: calc(var(--fs-gap) * 2);
        }
        .pretui-fieldset:disabled .pretui-fieldset-legend {
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
