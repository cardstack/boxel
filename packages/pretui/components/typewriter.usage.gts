// Pretui — Typewriter usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Typewriter } from './typewriter';

// ── Typewriter — fresh page (no upstream knob rig) ───────────────────────
class TypewriterUsage extends Component {
  @tracked text =
    'Confirm the spring booking — Da Hong Pao, Wuyishan lot B-1181.';
  @tracked speed = 16;
  @tracked caret = true;
  @tracked startDelay = 0;
  @tracked run = 0;
  setText = (v: string) => (this.text = v);
  setSpeed = (v: number | null) => (this.speed = v ?? 16);
  setCaret = (v: boolean) => (this.caret = v);
  setStartDelay = (v: number | null) => (this.startDelay = v ?? 0);
  replay = () => (this.run = this.run + 1);
  // identity-keyed single-item list: bumping run tears down and rebuilds
  // the component, restarting its CSS animations — the timer-free replay
  get runKey(): number[] {
    return [this.run];
  }
  get usage() {
    let bits = [`@text='${this.text}'`];
    if (this.speed !== 16) bits.push(`@speed={{${this.speed}}}`);
    if (this.caret) bits.push('@caret={{true}}');
    if (this.startDelay) bits.push(`@startDelay={{${this.startDelay}}}`);
    return `<Typewriter ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Typewriter'
      @description='Character-by-character reveal on a pure-CSS stagger — the static-choreography sibling of StreamingText (reading.gts): StreamingText paces live agent output arriving word-by-word, Typewriter choreographs a string it already holds. The line grows as it types, so the caret rides the insertion point.'
      @source={{this.usage}}
    >
      <:example>
        {{#each this.runKey key='@identity' as |run|}}
          <Typewriter
            @text={{this.text}}
            @speed={{this.speed}}
            @caret={{this.caret}}
            @startDelay={{this.startDelay}}
            data-run={{run}}
          />
        {{/each}}
        <div class='pretui-demo-replay'>
          <Button
            @size='xs'
            @appearance='outlined'
            {{on 'click' this.replay}}
          >Replay</Button>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @required={{true}}
          @value={{this.text}}
          @description='The string to type out. The full text is mirrored in an sr-only span; the animated copy is aria-hidden.'
          @onInput={{this.setText}}
        />
        <Args.Number
          @name='speed'
          @defaultValue={{16}}
          @value={{this.speed}}
          @min={{1}}
          @max={{60}}
          @step={{1}}
          @description='Reveal rate in characters per second — each char lands at index / speed seconds.'
          @onInput={{this.setSpeed}}
        />
        <Args.Bool
          @name='caret'
          @defaultValue={{false}}
          @value={{this.caret}}
          @description='Blinking insertion-point caret; blinks via CSS steps, sits after the last revealed character.'
          @onInput={{this.setCaret}}
        />
        <Args.Number
          @name='startDelay'
          @defaultValue={{0}}
          @value={{this.startDelay}}
          @min={{0}}
          @max={{5}}
          @step={{0.5}}
          @description='Seconds before the first character lands — for sequencing several Typewriters into one choreography.'
          @onInput={{this.setStartDelay}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-replay {
        margin-top: 12px;
      }
    </style>
  </template>
}

export const DEMOS_TYPEWRITER: Record<string, unknown> = {
  Typewriter: TypewriterUsage,
};
