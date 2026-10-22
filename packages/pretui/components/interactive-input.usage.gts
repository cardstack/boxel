// Pretui — InteractiveInput usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { InteractiveInput } from './interactive-input';
import type { InteractiveInputOption } from './interactive-input';

// ── InteractiveInput ─────────────────────────────────────────────────────
const SWATCHES: InteractiveInputOption[] = [
  { value: '#C3FC33', label: 'Lime', swatch: '#C3FC33' },
  { value: '#00A884', label: 'Jade', swatch: '#00A884' },
  { value: '#AC00FF', label: 'Violet', swatch: '#AC00FF' },
  { value: '#E3474C', label: 'Vermilion', swatch: '#E3474C' },
];

class InteractiveInputUsage extends GlimmerComponent {
  @tracked value = '#C3FC33';
  @tracked answered = false;

  setValue = (value: string) => (this.value = value);
  setAnswered = (answered: boolean) => (this.answered = answered);
  rerun = () => (this.answered = true);
  reset = () => (this.answered = false);

  <template>
    <FreestyleUsage
      @name='InteractiveInput'
      @description='The agent cannot continue until it has a value, and the whole point of the pattern is that it asks with a TYPED picker rather than free text: the answer is one of a known set, so the reader chooses instead of spelling. Answering does not resume anything — it arms an explicit "Re-run with #C3FC33", because a value that silently restarts a run is a value you cannot review. The picker is a real fieldset of native radios, which is where the arrow keys, Home/End, the grouped announcement and the :checked styling hook all come from; the swatch-div original had none of them. While the request is live the block wears the reserved attention hue, and the moment it settles it gives that hue back.'
    >
      <:example>
        <InteractiveInput
          @prompt='Which accent should the callout use?'
          @detail='It will be applied to every callout in the generated report.'
          @options={{SWATCHES}}
          @value={{this.value}}
          @onValueChange={{this.setValue}}
          @onRerun={{this.rerun}}
          @answered={{this.answered}}
        />
        <p class='demo-log'>picked:
          <strong>{{this.value}}</strong></p>
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.reset}}
        >Ask again</Button>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='The typed choices: { value, label?, swatch? }. `swatch` is a caller colour, so it goes through the kit-wide cssValue allowlist — a rejected value loses its swatch rather than becoming a declaration.'
          @value={{SWATCHES}}
        />
        <Args.String
          @name='value'
          @description='The current pick. Uncontrolled by default (@defaultValue seeds it, else the first option).'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.Bool
          @name='answered'
          @description='Settled: the picker disables and the block reads as a receipt in the quiet palette instead of a live request.'
          @value={{this.answered}}
          @onInput={{this.setAnswered}}
          @defaultValue={{false}}
        />
        <Args.Yield
          @name='picker'
          @description='Replaces the built-in radio picker, receiving (value, setValue). This is the escape hatch for a value this component cannot express as a pill — a date, a card reference, a numeric range — without widening the option shape until it means nothing.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='verb / prompt / detail / onRerun / rerunLabel / answeredLabel'
          @description='The tier verb (default INPUT, matching the WorkItem grammar), the question and its second line, the commit callback, and the two wordings. @rerunLabel receives the picked value, so a caller can phrase the CTA in their own domain.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-log {
        margin: var(--space-4, 11px) 0 var(--space-3, 7px);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .demo-log strong {
        font-family: var(--font-mono);
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_INTERACTIVE_INPUT: Record<string, unknown> = {
  InteractiveInput: InteractiveInputUsage,
};
