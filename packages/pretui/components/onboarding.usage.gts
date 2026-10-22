// Pretui — Onboarding usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Onboarding } from './onboarding';
import type { OnboardingStep } from './onboarding';

// ── Onboarding ───────────────────────────────────────────────────────────
const STEPS: OnboardingStep[] = [
  {
    id: 'o1',
    title: 'Attach what the agent should see',
    caption: 'Attach',
    body: 'Anything you are viewing is offered as context automatically. Pin it to keep it attached for the whole session, or drop it and the agent never sees it.',
  },
  {
    id: 'o2',
    title: 'Ask before you Act',
    caption: 'Modes',
    body: 'Ask reads only. Act may propose changes, and every change it proposes arrives as a receipt you keep or revert — nothing is written behind your back.',
  },
  {
    id: 'o3',
    title: 'Read the trace',
    caption: 'Trace',
    body: 'Every answer carries the reasoning that produced it, folded away by default. Open it when the answer surprises you.',
  },
  {
    id: 'o4',
    title: 'Keep what works',
    caption: 'Keep',
    body: 'Standing instructions and saved prompts persist across sessions, so the second run starts where the first one ended.',
  },
];

class OnboardingUsage extends GlimmerComponent {
  @tracked current = 0;
  @tracked outcome = '';

  setCurrent = (index: number) => (this.current = index);
  done = () => (this.outcome = 'finished the walkthrough');
  skip = () => (this.outcome = 'skipped the walkthrough');
  restart = () => {
    this.current = 0;
    this.outcome = '';
  };

  <template>
    <FreestyleUsage
      @name='Onboarding'
      @description='The first-run walkthrough. Four decisions carry it. The rail is StepList — the same rail SessionPrep uses — so the kit has one visual grammar for "where am I in a sequence". The media is a slot, not a prop: an onboarding step shows a video, a screenshot, a live component or nothing, and no prop shape covers all four. Position is announced ("Step 2 of 4 — Ask before you Act"), because a walkthrough whose progress is only visible is a walkthrough a screen-reader user has to count. And Skip is always available and never hidden behind a corner glyph — a walkthrough you cannot leave is a modal, and this is not one.'
    >
      <:example>
        {{#if this.outcome}}
          <p class='demo-log'>You
            {{this.outcome}}.</p>
        {{else}}
          <Onboarding
            @steps={{STEPS}}
            @current={{this.current}}
            @onStepChange={{this.setCurrent}}
            @onDone={{this.done}}
            @onSkip={{this.skip}}
          >
            <:media as |step index|>
              <div class='demo-media'>
                <span class='demo-media-num'>{{index}}</span>
                <span class='demo-media-cap'>{{step.caption}}</span>
              </div>
            </:media>
          </Onboarding>
        {{/if}}
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.restart}}
        >Start over</Button>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='steps'
          @description='{ id, title, body?, caption? }. `caption` is the rail label when the title is too long for a marker — the rail should read at a glance and the scene should read in full.'
          @value={{STEPS}}
        />
        <Args.Number
          @name='current'
          @description='Controlled index, clamped to the step range so an out-of-bounds value can never blank the scene. Uncontrolled it starts at @defaultCurrent.'
          @value={{this.current}}
          @onInput={{this.setCurrent}}
          @defaultValue={{0}}
          @min={{0}}
          @max={{3}}
        />
        <Args.Yield
          @name='media'
          @description='The step’s illustration, receiving (step, index). Drop a HoverVideoPlayer in here and the walkthrough previews the feature it is describing; supply nothing and the scene collapses to a single column.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='onStepChange / onDone / onSkip'
          @description='Next on the last step fires @onDone instead of advancing. @onSkip is optional and gates the skip button, because an escape hatch that does nothing is worse than none.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='label / doneLabel / skipLabel / variant'
          @description='The scene’s accessible name, the final-step button face (default "Get started"), the skip wording, and the rail presentation passed to StepList (default "track").'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-log {
        margin: 0 0 var(--space-4, 11px);
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .demo-media {
        display: grid;
        place-items: center;
        gap: 4px;
        aspect-ratio: 16 / 10;
        background: linear-gradient(
          140deg,
          color-mix(in oklch, var(--primary) 16%, var(--card)),
          var(--inset, var(--boxel-100))
        );
      }
      .demo-media-num {
        font-family: var(--font-mono);
        font-size: 34px;
        font-weight: 700;
        line-height: 1;
        color: color-mix(
          in oklch,
          var(--foreground) 24%,
          var(--primary)
        );
        font-variant-numeric: tabular-nums;
      }
      .demo-media-cap {
        font-size: var(--text-ui-sm, 11.5px);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_ONBOARDING: Record<string, unknown> = {
  Onboarding: OnboardingUsage,
};
