// Pretui — Spinner usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Spinner } from '../feedback';

// ── Spinner ← loading-indicator/usage.gts + circle-spinner/usage.gts ─────
// Dropped knobs: color (Spinner inherits currentColor — tint the wrapper,
// shown in the specimen), variant (no theme-variant matrix; currentColor
// covers it).
class SpinnerUsage extends GlimmerComponent {
  @tracked size = 20;
  setSize = (v: number | null) => {
    if (v !== null) {
      this.size = v;
    }
  };
  <template>
    <FreestyleUsage
      @name='Spinner'
      @description='Default loading indicator for Boxel components.'
    >
      <:example>
        <Spinner @size={{this.size}} />
        <span class='tint-primary'><Spinner @size={{this.size}} /></span>
        <span class='tint-danger'><Spinner @size={{this.size}} /></span>
        <p class='note'>Stroke color follows currentColor — the tinted
          specimens wrap the spinner in colored text.</p>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='size'
          @description='Sets height and width for loading indicator icon.'
          @defaultValue={{13}}
          @value={{this.size}}
          @min={{10}}
          @max={{48}}
          @step={{1}}
          @onInput={{this.setSize}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .tint-primary {
        color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        display: inline-flex;
      }
      .tint-danger {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
        display: inline-flex;
      }
      .note {
        flex-basis: 100%;
        text-align: center;
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SPINNER: Record<string, unknown> = {
  Spinner: SpinnerUsage,
};
