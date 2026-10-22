// Pretui — SessionPrep usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { SessionPrep } from './session-prep';
import type { SessionPrepStep } from './session-prep';

// ── SessionPrep ──────────────────────────────────────────────────────────
const PREP_VARIANTS = ['steps', 'track'];

class SessionPrepUsage extends GlimmerComponent {
  @tracked stage = 1;
  @tracked variant = 'steps';
  @tracked skipped = false;

  setVariant = (variant: string) => (this.variant = variant);
  advance = () => (this.stage = this.stage >= 3 ? 0 : this.stage + 1);
  skip = () => (this.skipped = true);
  reset = () => {
    this.skipped = false;
    this.stage = 1;
  };

  get variantValue(): 'steps' | 'track' {
    return this.variant === 'track' ? 'track' : 'steps';
  }
  get steps(): SessionPrepStep[] {
    let labels = [
      'Summarise the previous session',
      'Copy the file history',
      'Prepare the session context',
    ];
    return labels.map((label, i) => ({
      id: 's' + i,
      label,
      state:
        i < this.stage ? 'complete' : i === this.stage ? 'running' : 'pending',
    }));
  }

  <template>
    <FreestyleUsage
      @name='SessionPrep'
      @description='Everything an agent does before your first message — summarising the last session, reading the file history, assembling context — happens whether or not it is shown. The law the spec states is that it must be shown, with a way out. The rail is StepList, unmodified: it already owns the numbered markers, the connector lines, the four-state palette, the per-step state text for assistive tech, and the derived "2 of 3 complete" summary wired with aria-describedby. Re-implementing that here would have produced a second, worse copy — so SessionPrep is the frame, the note, and the escape hatch, and a walkthrough (Onboarding) and a preparation read as one system because they share a rail.'
    >
      <:example>
        {{#if this.skipped}}
          <p class='demo-log'>Preparation skipped — the session starts cold.</p>
        {{else}}
          <SessionPrep
            @steps={{this.steps}}
            @note='Nothing is sent to the model until this finishes. Skipping starts the session without the previous context.'
            @variant={{this.variantValue}}
            @onSkip={{this.skip}}
          />
        {{/if}}
        <span class='demo-row'>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            {{on 'click' this.advance}}
          >Advance a step</Button>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            {{on 'click' this.reset}}
          >Reset</Button>
        </span>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='steps'
          @description='{ id, label, state?: pending | running | complete | failed }. The states map onto StepList’s upcoming / current / complete / error, so the rail’s palette and its screen-reader state text come for free.'
          @value={{this.steps}}
        />
        <Args.String
          @name='variant'
          @description='Rail presentation, passed straight to StepList. "steps" is the numbered rail; "track" is the segmented bar for a pipeline read at a glance.'
          @value={{this.variant}}
          @options={{PREP_VARIANTS}}
          @onInput={{this.setVariant}}
          @defaultValue='steps'
        />
        <Args.Base
          @name='title / note / onSkip / skipLabel'
          @description='The heading, the line explaining why the wait exists, and the escape hatch — omit @onSkip and no skip button renders, because an escape hatch that does nothing is worse than none.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='default'
          @description='Extra content below the rail — a model picker, a skill chooser, the "1 Skill ▴" row from the session-chrome spec.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='not built'
          @description='Per-step detail lines ("41 messages scanned"). StepItem is { label, state } and widening it is StepList’s call, not this component’s — named here rather than hidden.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-log {
        margin: 0 0 var(--space-4, 11px);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .demo-row {
        display: inline-flex;
        gap: 8px;
        margin-top: var(--space-4, 11px);
      }
    </style>
  </template>
}

export const DEMOS_SESSION_PREP: Record<string, unknown> = {
  SessionPrep: SessionPrepUsage,
};
