// Pretui — Divider usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Divider } from './divider';
import { ORIENTATIONS } from '../internal/composites-fixtures';

// ── Divider ← wa-divider ─────────────────────────────────────────────────
// Dropped knobs: --color/--width (the hairline IS the --border token; one
// spacing knob survives as --pretui-divider-spacing). Added: the centered
// @label variant WA doesn't ship — horizontal only; vertical ignores it.
class DividerUsage extends Component {
  orientationOptions = ORIENTATIONS;
  @tracked orientation = 'horizontal';
  @tracked labelText = 'or';
  setOrientation = (v: string) => (this.orientation = v);
  setLabel = (v: string) => (this.labelText = v);
  get orientationVal() {
    return this.orientation as 'horizontal' | 'vertical';
  }
  get isVertical() {
    return this.orientation === 'vertical';
  }
  get usage() {
    let bits: string[] = [];
    if (this.orientation !== 'horizontal')
      bits.push(`@orientation='${this.orientation}'`);
    if (this.labelText && !this.isVertical)
      bits.push(`@label='${this.labelText}'`);
    return `<Divider${bits.length ? ' ' + bits.join(' ') : ''} />`;
  }
  <template>
    <FreestyleUsage
      @name='Divider'
      @description="Semantic role='separator' rule for grouping adjacent content — one hairline riding the --border token, horizontal or vertical. The centered label variant (the 'or' between form alternatives) is a Pretui addition over wa-divider."
      @source={{this.usage}}
    >
      <:example>
        {{#if this.isVertical}}
          <div class='pretui-divider-demo-row'>
            <span>Continue with email</span>
            <Divider @orientation='vertical' />
            <span>Continue with SSO</span>
          </div>
        {{else}}
          <div class='pretui-divider-demo-col'>
            <span>Continue with email</span>
            <Divider @label={{this.labelText}} />
            <span>Continue with SSO</span>
          </div>
        {{/if}}
      </:example>
      <:api as |Args|>
        <Args.String
          @name='orientation'
          @defaultValue='horizontal'
          @value={{this.orientation}}
          @options={{this.orientationOptions}}
          @description='Line direction; aria-orientation follows.'
          @onInput={{this.setOrientation}}
        />
        <Args.String
          @name='label'
          @value={{this.labelText}}
          @description='Centered label — horizontal orientation only; a vertical divider ignores it.'
          @onInput={{this.setLabel}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-divider-spacing'
          @type='length'
          @description="Margin along the divider's cross axis — WA's --spacing knob, defaulting to the --space-4 token."
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-divider-demo-row {
        display: flex;
        align-items: stretch;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .pretui-divider-demo-row > span {
        align-self: center;
      }
      .pretui-divider-demo-col {
        display: block;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_DIVIDER: Record<string, unknown> = {
  Divider: DividerUsage,
};
