// Pretui — shared by the usage-page machinery: ember-freestyle, ported (verbatim-reuse directive) and dogfooded:
// same invocation surface as addon/components/freestyle/usage (<:example>,
// <:api as |Args|> with Args.String/Bool/Number/Array/Object/Component/
// Action/Yield/Base, <:cssVars as |Css|>), but the machinery wears the kit —
// Select/Input/Switch/Slider as knob controls, Table for the API docs, and
// the Viewport frame around every example. Layout evolution (Chris): the
// interactive knobs render as a right-hand PROPERTY LIST while the API table
// below documents types/descriptions/defaults — the same <:api> block is
// yielded twice through two lenses (prop / doc), so usage pages stay
// verbatim-freestyle. Deliberate deltas: no ember-freestyle service, plain
// <pre> for @source, labeled controls.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

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
  Args: { label?: string; required?: boolean };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const PropRow: TemplateOnlyComponent<PropRowSignature> = <template>
  <div class='proprow' data-test-pretui-prop-row ...attributes>
    <span class='proprow-label' data-test-pretui-prop-row-label>
      {{@label}}
      {{#if @required}}<span class='proprow-req'>*</span>{{/if}}
    </span>
    <span class='proprow-control'>{{yield}}</span>
  </div>
  <style scoped>
    /* workbench inspector row: label rail left, control right */
    .proprow {
      --proprow-label-w: 8rem;

      display: grid;
      grid-template-columns: var(--proprow-label-w) minmax(0, 1fr);
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
        min-width: 0;
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
