// Pretui — Cue usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Cue } from './cue';
import type { CueKind, CuePosition, CueTone } from './cue';

const CUE_KINDS = ['label', 'description', 'status', 'error'];
const CUE_POSITIONS = [
  'block-start',
  'block-end',
  'inline-start',
  'inline-end',
];
const CUE_TONES = ['neutral', 'info', 'success', 'warning', 'danger'];

export class CueUsage extends GlimmerComponent {
  @tracked kind = 'description';
  @tracked position = 'block-end';
  @tracked tone = 'info';
  @tracked text = '12 matching lots';

  setKind = (value: string) => (this.kind = value);
  setPosition = (value: string) => (this.position = value);
  setTone = (value: string) => (this.tone = value);
  setText = (value: string) => (this.text = value);

  get kindValue() {
    return this.kind as CueKind;
  }
  get positionValue() {
    return this.position as CuePosition;
  }
  get toneValue() {
    return this.tone as CueTone;
  }

  <template>
    <FreestyleUsage
      @name='Cue'
      @description='A semantic accessory for a control: label, description, live status or error. Tone always carries a second glyph channel, so meaning survives greyscale.'
      @source='<Cue @kind="status" @tone="info" @text="12 matching lots" />'
      @viewportMode='inline'
    >
      <:example>
        <Cue
          @kind={{this.kindValue}}
          @position={{this.positionValue}}
          @tone={{this.toneValue}}
          @text={{this.text}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='kind'
          @options={{CUE_KINDS}}
          @value={{this.kind}}
          @defaultValue='description'
          @onInput={{this.setKind}}
        />
        <Args.String
          @name='position'
          @options={{CUE_POSITIONS}}
          @value={{this.position}}
          @defaultValue='block-end'
          @onInput={{this.setPosition}}
        />
        <Args.String
          @name='tone'
          @options={{CUE_TONES}}
          @value={{this.tone}}
          @defaultValue='neutral'
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='text'
          @value={{this.text}}
          @onInput={{this.setText}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}


export const DEMOS_CUE: Record<string, unknown> = {
  Cue: CueUsage,
};
