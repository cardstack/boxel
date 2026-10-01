// Pretui — Indicator usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Indicator } from './indicator';
import { Avatar } from './avatar';
import type { PretuiToneArg } from '../pretui-primitives';

const TONES = ['success', 'warning', 'danger', 'info', 'neutral', 'primary'];

export class IndicatorUsage extends Component {
  tones = TONES;
  @tracked label = 'Online';
  @tracked tone = 'success';
  @tracked ping = false;
  get toneArg() {
    return this.tone as PretuiToneArg;
  }
  setLabel = (v: string) => (this.label = v);
  setTone = (v: string) => (this.tone = v);
  setPing = (v: boolean) => (this.ping = v);
  get usage() {
    let bits = [`@label='${this.label}'`];
    if (this.tone !== 'success') bits.push(`@tone='${this.tone}'`);
    if (this.ping) bits.push('@ping={{true}}');
    return `<Indicator ${bits.join(' ')} @circular={{true}}>\n  <Avatar @name='Ana Ruiz' />\n</Indicator>`;
  }
  <template>
    <FreestyleUsage
      @name='Indicator'
      @description='A named status dot on the corner of another element: online, live, unread. The dot is decoration; the required label is spoken after the child, so colour and the ping are never the only signal. A count is Badge.'
      @source={{this.usage}}
    >
      <:example>
        <div class='in-demo'>
          <Indicator @label={{this.label}} @tone={{this.toneArg}} @ping={{this.ping}} @circular={{true}}>
            <Avatar @name='Ana Ruiz' />
          </Indicator>
          <span>Ana Ruiz</span>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String @name='label' @required={{true}} @value={{this.label}} @onInput={{this.setLabel}} />
        <Args.String @name='tone' @value={{this.tone}} @options={{this.tones}} @defaultValue='success' @onInput={{this.setTone}} />
        <Args.Bool @name='ping' @value={{this.ping}} @defaultValue={{false}} @description='A pulsing ring. Reduced motion keeps the solid dot.' @onInput={{this.setPing}} />
        <Args.String @name='placement' @defaultValue='top-end' />
        <Args.Bool @name='circular' @defaultValue={{false}} />
        <Args.Bool @name='invisible' @defaultValue={{false}} />
        <Args.Yield @name='default' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .in-demo {
        display: flex;
        align-items: center;
        gap: var(--space-3, 0.5rem);
        padding: var(--space-4, 0.6875rem);
        font-size: var(--text-ui-md, 0.78rem);
      }
    </style>
  </template>
}

export const DEMOS_INDICATOR: Record<string, unknown> = {
  Indicator: IndicatorUsage,
};
