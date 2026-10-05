// Pretui — Spotlight usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Chip } from './chip';
import { Spotlight } from './spotlight';
import { lots } from '../demo-motion-pointer';

// ── Spotlight ────────────────────────────────────────────────────────────
class SpotlightUsage extends Component {
  @tracked size = 260;
  @tracked hue = '';
  @tracked intensity = 0.5;
  @tracked rest = 0.34;
  @tracked restX = 0.5;
  @tracked restY = 0.5;
  @tracked followFocus = true;
  setSize = (v: number | null) => (this.size = v ?? 260);
  setHue = (v: string) => (this.hue = v);
  setIntensity = (v: number | null) => (this.intensity = v ?? 0.5);
  setRest = (v: number | null) => (this.rest = v ?? 0.34);
  setRestX = (v: number | null) => (this.restX = v ?? 0.5);
  setRestY = (v: number | null) => (this.restY = v ?? 0.5);
  setFollowFocus = (v: boolean) => (this.followFocus = v);
  get rows() {
    return lots('spotlight');
  }
  get usage() {
    let bits = [`@size={{${this.size}}}`, `@rest={{${this.rest}}}`];
    if (this.intensity !== 0.5) bits.push(`@intensity={{${this.intensity}}}`);
    if (this.hue) bits.push(`@hue='${this.hue}'`);
    if (!this.followFocus) bits.push('@followFocus={{false}}');
    return `<Spotlight ${bits.join(' ')}>\n  … surface content …\n</Spotlight>`;
  }
  <template>
    <FreestyleUsage
      @name='Spotlight'
      @description='A pointer-anchored wash over a surface the component owns. motion-primitives’ Spotlight reaches into its PARENT on mount and mutates that node’s position and overflow — an invisible side effect on something it does not own, and the reason it silently fails inside any parent that needs visible overflow. Here Spotlight is the container, so the relative/overflow contract sits on a node it declares. The light is a fixed-size layer moved with translate (compositor-friendly, and transitionable in a way a radial-gradient position is not) and softened with gradient stops instead of filter: blur, which is markedly cheaper. Law 8: @rest is an opacity floor, not 0 — the surface is lit in a still frame. Law 5 encoding: the light travels to whatever child takes focus, so it reports which surface is live and where focus sits inside it. Honest limit: the surface clips its content, so a Spotlight cannot host a popover that needs to escape its box.'
      @source={{this.usage}}
    >
      <:example>
        <Spotlight
          @size={{this.size}}
          @hue={{this.hue}}
          @intensity={{this.intensity}}
          @rest={{this.rest}}
          @restX={{this.restX}}
          @restY={{this.restY}}
          @followFocus={{this.followFocus}}
          class='spot-surface'
        >
          <div class='spot-head'>
            <h4 class='spot-title'>Cupping panel · Wuyishan</h4>
            <Chip @label='In session' @hue='#0ea5a4' />
          </div>
          <ul class='spot-list'>
            {{#each this.rows as |row|}}
              <li class='spot-row'>
                <span class='spot-tea'>{{row.tea}}</span>
                <span class='spot-meta'>lot {{row.lot}}</span>
                <Button @size='xs' @appearance='plain'>Score</Button>
              </li>
            {{/each}}
          </ul>
        </Spotlight>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='size'
          @defaultValue={{260}}
          @value={{this.size}}
          @min={{80}}
          @max={{600}}
          @step={{10}}
          @description='Diameter of the light in px. Larger than the surface reads as a general wash rather than a pointer anchor.'
          @onInput={{this.setSize}}
        />
        <Args.Number
          @name='intensity'
          @defaultValue={{0.5}}
          @value={{this.intensity}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='Peak strength of the light at its centre, mixed against the hue with color-mix. Law 6: this is chrome — nothing a reader must parse ever lives in it.'
          @onInput={{this.setIntensity}}
        />
        <Args.Number
          @name='rest'
          @defaultValue={{0.34}}
          @value={{this.rest}}
          @min={{0}}
          @max={{1}}
          @step={{0.02}}
          @description='Opacity floor when nothing is engaged — the resting state. Setting it to 0 reproduces the upstream behavior of vanishing entirely, which fails the screenshot test.'
          @onInput={{this.setRest}}
        />
        <Args.String
          @name='hue'
          @value={{this.hue}}
          @description='Any CSS color for the light. Empty falls back to the --primary token.'
          @onInput={{this.setHue}}
        />
        <Args.Number
          @name='restX'
          @defaultValue={{0.5}}
          @value={{this.restX}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='Resting x origin as a fraction of the surface width — where the wash parks before anything engages.'
          @onInput={{this.setRestX}}
        />
        <Args.Number
          @name='restY'
          @defaultValue={{0.5}}
          @value={{this.restY}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='Resting y origin as a fraction of the surface height.'
          @onInput={{this.setRestY}}
        />
        <Args.Bool
          @name='followFocus'
          @defaultValue={{true}}
          @value={{this.followFocus}}
          @description='Travel the light to a focused child on focusin. Tab into the Score buttons to see it; this is the keyboard path upstream never had.'
          @onInput={{this.setFollowFocus}}
        />
        <Args.Yield
          @name='default'
          @description='The lit surface’s content. It renders above the light and keeps all of its own events — the light layer is pointer-events: none and aria-hidden.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-spotlight-surface'
          @type='color'
          @description='Surface color under the light — defaults to the --card token.'
        />
        <Css.Basic
          @name='pretui-spotlight-radius'
          @type='length'
          @description='Corner radius of the surface — defaults to the --radius token.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .spot-surface {
        padding: 18px;
        min-height: 190px;
      }
      .spot-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 14px;
      }
      .spot-title {
        margin: 0;
        font-size: var(--text-heading-sm, 15px);
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--card-foreground);
      }
      .spot-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 10px;
      }
      .spot-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .spot-tea {
        font-size: var(--text-ui-lg, 13.5px);
        color: var(--card-foreground);
      }
      .spot-meta {
        flex: 1;
        font-size: var(--text-ui-md, 12.5px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SPOTLIGHT: Record<string, unknown> = {
  Spotlight: SpotlightUsage,
};
