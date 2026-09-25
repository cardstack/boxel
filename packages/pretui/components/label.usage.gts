// Pretui — Label usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Label } from './label';

const LABEL_TAGS = ['label', 'span', 'legend'];

// ── Label ← label/index.gts (no upstream usage page) ─────────────────────
// Dropped knobs: @size ('small' | 'default' — the Pretui Label is a
// single-size mono eyebrow; sizing rides the token sheet), @ellipsize (no
// truncation variant in wave-0), free @tag (keyof HTMLElementTagNameMap —
// narrowed to the three tags a field label actually takes).
class LabelUsage extends Component {
  tagOptions = LABEL_TAGS;
  @tracked tag = 'label';
  @tracked text = 'Card number';
  setTag = (v: string) => (this.tag = v);
  setText = (v: string) => (this.text = v);
  get tagVal() {
    return this.tag as 'label' | 'span' | 'legend';
  }
  get usage() {
    let tagBit = this.tag === 'label' ? '' : ` @tag='${this.tag}'`;
    return `<Label${tagBit}>${this.text}</Label>`;
  }
  <template>
    <FreestyleUsage
      @name='Label'
      @description='Small-caps mono field label — the eyebrow voice shared by property rows and table headers. Renders as label, span, or legend.'
      @source={{this.usage}}
    >
      <:example>
        <Label @tag={{this.tagVal}}>{{this.text}}</Label>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='tag'
          @defaultValue='label'
          @value={{this.tag}}
          @options={{this.tagOptions}}
          @description="Element to render — boxel-ui's free keyof HTMLElementTagNameMap, narrowed to label / span / legend."
          @onInput={{this.setTag}}
        />
        <Args.String
          @name='for'
          @description='id of the control this label points at (label tag only).'
        />
        <Args.String
          @name='text'
          @value={{this.text}}
          @description='Demo knob for the default block content.'
          @onInput={{this.setText}}
        />
        <Args.Yield @description='Label content as the default block.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_LABEL: Record<string, unknown> = {
  Label: LabelUsage,
};
