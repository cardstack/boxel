// Pretui — Presence usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Presence } from './presence';
import type { MotionPreset } from '../internal/motion-core';
import { PRESETS } from '../demo-motion-core';

// ── Presence — fresh page (no upstream knob rig) ─────────────────────────
class PresenceUsage extends Component {
  @tracked show = true;
  @tracked enter: MotionPreset = 'rise';
  @tracked exit: MotionPreset = 'fade';
  @tracked duration = 0.24;
  @tracked exitDuration = 0.16;
  @tracked delay = 0;
  @tracked distance = 8;
  @tracked scale = 0.96;
  setShow = (v: boolean) => (this.show = v);
  setEnter = (v: string) => (this.enter = v as MotionPreset);
  setExit = (v: string) => (this.exit = v as MotionPreset);
  setDuration = (v: number | null) => (this.duration = v ?? 0.24);
  setExitDuration = (v: number | null) => (this.exitDuration = v ?? 0.16);
  setDelay = (v: number | null) => (this.delay = v ?? 0);
  setDistance = (v: number | null) => (this.distance = v ?? 8);
  setScale = (v: number | null) => (this.scale = v ?? 0.96);
  toggle = () => (this.show = !this.show);
  get usage() {
    let bits = [
      `@show={{this.show}}`,
      `@enter='${this.enter}'`,
      `@exit='${this.exit}'`,
      `@duration={{${this.duration}}}`,
      `@exitDuration={{${this.exitDuration}}}`,
    ];
    if (this.delay) bits.push(`@delay={{${this.delay}}}`);
    return `<Presence ${bits.join(' ')}>\n  <LotCard />\n</Presence>`;
  }
  <template>
    <FreestyleUsage
      @name='Presence'
      @description='Enter and exit transitions for content that comes and goes — the CSS answer to AnimatePresence. @starting-style supplies the arriving state and transition-behavior: allow-discrete keeps display:block alive long enough to leave, so both halves run with no animation engine, no timers and no dependency. Presence owns visibility through @show: keep the content in the template rather than wrapping it in an if-block, or the exit half has nothing left to animate. Enter and exit are tuned separately, because arriving and leaving read differently.'
      @source={{this.usage}}
    >
      <:example>
        <div class='presence-stage'>
          <Button
            @size='xs'
            @appearance='outlined'
            {{on 'click' this.toggle}}
          >{{if this.show 'Withdraw lot' 'Offer lot'}}</Button>
          <Presence
            @show={{this.show}}
            @enter={{this.enter}}
            @exit={{this.exit}}
            @duration={{this.duration}}
            @exitDuration={{this.exitDuration}}
            @delay={{this.delay}}
            @distance={{this.distance}}
            @scale={{this.scale}}
          >
            <div class='presence-card'>
              <p class='presence-title'>Da Hong Pao · lot B-1181</p>
              <p class='presence-meta'>Wuyi Origins · Wuyishan · $102/kg</p>
            </div>
          </Presence>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='show'
          @defaultValue={{true}}
          @value={{this.show}}
          @description='Visible when true. Presence owns display — while hidden the content is display:none (out of the accessibility tree) and inert during the exit window, so focus can never land inside something on its way out.'
          @onInput={{this.setShow}}
        />
        <Args.String
          @name='enter'
          @defaultValue='fade'
          @value={{this.enter}}
          @options={{PRESETS}}
          @description='Entrance preset. fade holds still; rise/fall travel on the block axis; slide travels on the inline axis; scale grows into place. All five resolve through --pretui-motion-distance / --pretui-motion-scale.'
          @onInput={{this.setEnter}}
        />
        <Args.String
          @name='exit'
          @defaultValue='(matches @enter)'
          @value={{this.exit}}
          @options={{PRESETS}}
          @description='Exit preset, settable independently of @enter (Law 7). A panel that rises in and simply fades out reads calmer than one that reverses its own entrance.'
          @onInput={{this.setExit}}
        />
        <Args.Number
          @name='duration'
          @defaultValue={{0.22}}
          @value={{this.duration}}
          @min={{0.05}}
          @max={{1.5}}
          @step={{0.02}}
          @description='Entrance duration in seconds.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='exitDuration'
          @defaultValue={{0.15}}
          @value={{this.exitDuration}}
          @min={{0.05}}
          @max={{1.5}}
          @step={{0.02}}
          @description='Exit duration in seconds; defaults to two-thirds of @duration so leaving never lingers.'
          @onInput={{this.setExitDuration}}
        />
        <Args.Number
          @name='delay'
          @defaultValue={{0}}
          @value={{this.delay}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='Seconds before entering — the timer-free way to stagger a group of Presences into one choreography. Applies to the enter half only.'
          @onInput={{this.setDelay}}
        />
        <Args.Number
          @name='distance'
          @defaultValue={{8}}
          @value={{this.distance}}
          @min={{0}}
          @max={{48}}
          @step={{2}}
          @description='Travel in px for rise / fall / slide.'
          @onInput={{this.setDistance}}
        />
        <Args.Number
          @name='scale'
          @defaultValue={{0.96}}
          @value={{this.scale}}
          @min={{0.5}}
          @max={{1}}
          @step={{0.01}}
          @description='Start scale for the scale preset.'
          @onInput={{this.setScale}}
        />
        <Args.Yield
          @name='default'
          @description='The content whose arrival and departure is being staged. Rendered inside a wrapper div whose display comes from --pretui-presence-display (block by default; set it to flex or grid to keep a layout role).'
        />
        <Args.Base
          @name='--pretui-presence-display'
          @type='CSS'
          @defaultValue='block'
          @description='The display value the wrapper takes while shown.'
        />
        <Args.Base
          @name='--pretui-motion-distance'
          @type='CSS'
          @defaultValue='8px'
          @description='Travel for rise / fall / slide; @distance sets it.'
        />
        <Args.Base
          @name='--pretui-motion-scale'
          @type='CSS'
          @defaultValue='0.96'
          @description='Start scale for the scale preset; @scale sets it.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .presence-stage {
        display: grid;
        gap: var(--space-4, 11px);
        justify-items: start;
        min-height: 96px;
      }
      .presence-card {
        padding: var(--space-4, 11px) var(--space-5, 15px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 2px rgb(16 24 40 / 0.12)
        );
      }
      .presence-title {
        margin: 0;
        font-size: var(--text-ui-lg, 15px);
        font-weight: 600;
        letter-spacing: var(--track-heading, -0.02em);
        color: var(--foreground);
      }
      .presence-meta {
        margin: 4px 0 0;
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_PRESENCE: Record<string, unknown> = {
  Presence: PresenceUsage,
};
