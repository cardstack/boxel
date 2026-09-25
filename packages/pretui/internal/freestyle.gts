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
  <div class='proprow' ...attributes>
    <span class='proprow-label'>
      {{@label}}
      {{#if @required}}<span class='proprow-req'>*</span>{{/if}}
    </span>
    <span class='proprow-control'>{{yield}}</span>
  </div>
  <style scoped>
    /* workbench inspector row: label rail left, control right */
    .proprow {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      padding: 4px 0;
    }
    .proprow-label {
      font-family: var(--font-mono);
      font-size: var(--text-ui, 12px);
      color: var(--muted-foreground);
      overflow-wrap: anywhere;
    }
    .proprow-req {
      color: var(--pretui-destructive-ink, var(--boxel-danger));
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

export const PropReadOnly: TemplateOnlyComponent<PropReadOnlySignature> = <template>
  <span class='proprow-readonly' data-test-pretui-prop-readonly>{{@value}}</span>
  <style scoped>
    .proprow-readonly {
      display: block;
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--muted-foreground);
      font-family: var(--font-mono);
      font-size: var(--text-ui-sm, 11.5px);
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
