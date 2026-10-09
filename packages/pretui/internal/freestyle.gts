// Pretui — shared pieces of the usage pages (components/freestyle-usage.gts
// and the usage-* argument components): PropRow, one row of the property
// list; PropReadOnly, a knob's value when it has no control; the
// isPresent/readOnlyText helpers; and the ArgsMode/UsagePresetSignature types.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { VisuallyHidden } from '../components/visually-hidden';

export function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}
export function readOnlyText(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (v === '') return '""';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]';
  return String(v);
}
export type ArgsMode = 'doc' | 'prop';
// ── Property-list row (the prop lens) ────────────────────────────────────
interface PropRowSignature {
  Args: {
    label?: string;
    required?: boolean;
    /** id of the row's control: the rail becomes its <label for>, so the
     * visible text names the control and a click on it focuses it */
    controlId?: string;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const PropRow: TemplateOnlyComponent<PropRowSignature> = <template>
  <div class='proprow' data-test-pretui-prop-row ...attributes>
    {{#if @controlId}}
      <label
        class='proprow-label'
        for={{@controlId}}
        data-test-pretui-prop-row-label
      >
        {{@label}}
        {{#if @required}}<span
            class='proprow-req'
            aria-hidden='true'
          >*</span><VisuallyHidden> (required)</VisuallyHidden>{{/if}}
      </label>
    {{else}}
      <span class='proprow-label' data-test-pretui-prop-row-label>
        {{@label}}
        {{#if @required}}<span
            class='proprow-req'
            aria-hidden='true'
          >*</span><VisuallyHidden> (required)</VisuallyHidden>{{/if}}
      </span>
    {{/if}}
    <div class='proprow-control'>{{yield}}</div>
  </div>
  <style scoped>
    /* workbench inspector row: label rail left, control right */
    .proprow {
      --_proprow-label-w: 8rem;

      display: grid;
      grid-template-columns: var(--_proprow-label-w) minmax(0, 1fr);
      gap: var(--boxel-sp-xs);
      align-items: center;
      padding-block: var(--boxel-sp-3xs);
    }
    .proprow-label {
      font-family: var(--font-mono);
      font-size: var(--boxel-font-size-xs);
      color: var(--muted-foreground);
      overflow-wrap: break-word;
    }
    .proprow-req {
      color: var(--destructive-ink);
    }
    .proprow-control {
      min-width: 0;
    }
  </style>
</template>;

interface PropReadOnlySignature {
  Args: { value?: string };
  Element: HTMLSpanElement;
}

export const PropReadOnly: TemplateOnlyComponent<PropReadOnlySignature> =
  <template>
    <span
      class='proprow-readonly'
      data-test-pretui-prop-readonly
    >{{@value}}</span>
    <style scoped>
      .proprow-readonly {
        display: block;
        overflow-wrap: break-word;
        color: var(--muted-foreground);
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        line-height: 1.4;
      }
    </style>
  </template>;
// ── Action / Yield / Component presets (doc-only rows) ───────────────────
export interface UsagePresetSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}
