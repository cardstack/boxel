// Pretui — ReadinessPanel usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { ReadinessPanel } from './readiness-panel';
import type { ReadinessGate } from './readiness-panel';

const RELEASE_GATES: readonly ReadinessGate[] = [
  {
    id: 'tests',
    name: 'Test suite',
    state: 'pass',
    caption: 'All suites green on the release branch',
    value: '1284 / 1284',
  },
  {
    id: 'lint',
    name: 'Lint',
    state: 'pass',
    caption: 'No new findings',
    value: '0',
  },
  {
    id: 'budget',
    name: 'Bundle budget',
    state: 'pass',
    caption: 'Under the 240 KB ceiling',
    value: '221 KB',
  },
  {
    id: 'signoff',
    name: 'Design sign-off',
    state: 'pass',
    caption: 'Approved by the design reviewer',
  },
  {
    id: 'changelog',
    name: 'Changelog entry',
    state: 'skipped',
    caption: 'Not required for a patch release',
  },
];

const BLOCKED_GATES: readonly ReadinessGate[] = [
  {
    id: 'tests',
    name: 'Test suite',
    state: 'fail',
    caption: 'Two integration suites failing on the release branch',
    value: '1282 / 1284',
  },
  {
    id: 'lint',
    name: 'Lint',
    state: 'running',
    caption: 'Re-running after the last push',
  },
  {
    id: 'budget',
    name: 'Bundle budget',
    state: 'blocked',
    caption: 'Waiting for the test suite before it can measure',
    value: '240 KB',
  },
  {
    id: 'signoff',
    name: 'Design sign-off',
    state: 'pending',
    caption: 'Requested, not yet answered',
  },
  {
    id: 'audit',
    name: 'Licence audit',
    state: 'unknown',
    caption: 'The auditor has not reported since Tuesday',
  },
  {
    // Same name as the first gate on purpose: the source keyed its list on
    // the name and this row would have vanished.
    id: 'tests-legacy',
    name: 'Test suite',
    state: 'skipped',
    caption: 'Legacy runner, retired',
  },
];

const BLOCKING_REASONS: readonly string[] = [
  'Two integration suites are failing on the release branch.',
  'The bundle budget cannot be measured until the suite finishes.',
  'Design sign-off has been requested but not answered.',
];

class ReadinessPanelUsage extends Component {
  @tracked title = 'Release 4.11 to production';
  @tracked summary =
    'Every gate below has to clear before the train can leave.';
  @tracked reasonsTitle = 'Blocking';
  @tracked loading = false;
  @tracked applicable = true;
  @tracked announce = true;
  @tracked loadingRows = 4;

  setTitle = (v: string) => (this.title = v);
  setSummary = (v: string) => (this.summary = v);
  setReasonsTitle = (v: string) => (this.reasonsTitle = v);
  setLoading = (v: boolean) => (this.loading = v);
  setApplicable = (v: boolean) => (this.applicable = v);
  setAnnounce = (v: boolean) => (this.announce = v);
  setLoadingRows = (v: number) => (this.loadingRows = v);

  get readyGates(): ReadinessGate[] {
    return [...RELEASE_GATES];
  }
  get blockedGates(): ReadinessGate[] {
    return [...BLOCKED_GATES];
  }
  get reasons(): string[] {
    return [...BLOCKING_REASONS];
  }
  get noReasons(): string[] {
    return [];
  }
  get noGates(): ReadinessGate[] {
    return [];
  }

  get usage(): string {
    return (
      '<ReadinessPanel\n' +
      "  @title='" +
      this.title +
      "'\n" +
      '  @gates={{this.gates}}\n' +
      '  @reasons={{this.blockingReasons}}\n' +
      '>\n' +
      '  <:actions><Button>Release</Button></:actions>\n' +
      '</ReadinessPanel>'
    );
  }

  <template>
    <FreestyleUsage
      @name='ReadinessPanel'
      @description='A block: the headline verdict over a list of named gates. Composes Panel (the surface), Chip (the state pill), Token (the machine value), Skeleton (the loading rows) and EmptyState (nothing to judge) — it owns no state of its own. The two panels below are the same component with different data: a blocked panel promotes its reasons ABOVE the gate inventory, so you read WHY before you read WHAT, and a ready panel simply has no middle. That structural difference is the point; it survives greyscale, which a hue swap would not.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-rp-demo'>
          <ReadinessPanel
            @title={{this.title}}
            @summary={{this.summary}}
            @gates={{this.blockedGates}}
            @reasons={{this.reasons}}
            @reasonsTitle={{this.reasonsTitle}}
            @loading={{this.loading}}
            @loadingRows={{this.loadingRows}}
            @applicable={{this.applicable}}
            @announce={{this.announce}}
          >
            <:actions>
              <Button @size='s' @tone='primary' @disabled={{true}}>Release</Button>
            </:actions>
          </ReadinessPanel>

          <ReadinessPanel
            @title={{this.title}}
            @summary={{this.summary}}
            @gates={{this.readyGates}}
            @reasons={{this.noReasons}}
            @loading={{this.loading}}
            @loadingRows={{this.loadingRows}}
            @applicable={{this.applicable}}
            @announce={{this.announce}}
          >
            <:actions>
              <Button @size='s' @tone='primary'>Release</Button>
            </:actions>
          </ReadinessPanel>

          <ReadinessPanel
            @title='Compliance check'
            @summary='Nothing has reported for this territory yet.'
            @gates={{this.noGates}}
            @reasons={{this.noReasons}}
            @emptyTitle='No checks configured'
            @emptyMessage='Attach a policy set and its gates will report here.'
            @announce={{this.announce}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @value={{this.title}}
          @required={{true}}
          @description='What is being judged. Required, because a hardcoded domain title is the single thing that made the source unreusable.'
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='summary'
          @value={{this.summary}}
          @description='Optional sub-line under the verdict.'
          @onInput={{this.setSummary}}
        />
        <Args.Array
          @name='gates'
          @description='The gates, in reading order. Each is id / name / state / caption / value. State is pass, fail, blocked, running, pending, skipped or unknown — an unrecognised value resolves to unknown and still renders, so a gate can never silently disappear.'
        />
        <Args.Array
          @name='reasons'
          @description='Why it is blocked, as data — one string per reason, rendered as a counted list with real list semantics. Never a paragraph.'
        />
        <Args.String
          @name='reasonsTitle'
          @value={{this.reasonsTitle}}
          @defaultValue='Blocking'
          @description='Heading over the reasons list.'
          @onInput={{this.setReasonsTitle}}
        />
        <Args.String
          @name='verdict'
          @description='State the verdict outright: ready, blocked, pending or unknown. Omit it and it is derived — any fail or blocked gate wins, then running or pending, then unknown, then ready.'
        />
        <Args.String
          @name='verdictText'
          @description='Override the verdict wording. The built-in words are English defaults; this is how they stop being.'
        />
        <Args.Bool
          @name='loading'
          @value={{this.loading}}
          @defaultValue={{false}}
          @description='Reserve the gate rows while the gates are being fetched. Loading and empty are deliberately unmistakable from each other.'
          @onInput={{this.setLoading}}
        />
        <Args.Number
          @name='loadingRows'
          @value={{this.loadingRows}}
          @defaultValue={{3}}
          @min={{1}}
          @max={{12}}
          @description='How many rows to reserve while loading. Reserve the space the answer will need and nothing reflows when it lands.'
          @onInput={{this.setLoadingRows}}
        />
        <Args.Bool
          @name='applicable'
          @value={{this.applicable}}
          @defaultValue={{true}}
          @description='Render nothing at all when the panel does not apply. An empty shell reads as no problems, which is not what not-applicable means.'
          @onInput={{this.setApplicable}}
        />
        <Args.Bool
          @name='announce'
          @value={{this.announce}}
          @defaultValue={{true}}
          @description='Carry the verdict, the blocking count and the gate tally through a polite live region. Live regions do not announce initial content, so this is silent on mount and speaks only on a real transition.'
          @onInput={{this.setAnnounce}}
        />
        <Args.Object
          @name='stateText'
          @description='Per-state wording, for another language or another domain — Passed becomes Cleared, Running becomes Underway.'
        />
        <Args.String
          @name='emptyTitle'
          @description='Empty-state wording when there are no gates at all.'
        />
        <Args.String
          @name='emptyMessage'
          @description='Empty-state message.'
        />
        <Args.String
          @name='gatesLabel'
          @description='Accessible name for the gate list. Defaults to the title.'
        />
        <Args.Number
          @name='headingLevel'
          @defaultValue={{2}}
          @description='Heading level for the title within the host page: 1, 2, 3 or 4.'
        />
        <Args.Yield
          @name='actions'
          @description='The action the verdict is about. It sits beside the verdict rather than in a detached footer, because Release belongs next to Ready.'
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the built-in empty state.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-verdict-tone'
          @type='color'
          @description='The verdict banner tone. Written from the same TypeScript record the glyph and the wording come from, so the token appears once.'
        />
        <Css.Basic
          @name='pretui-gate-tone'
          @type='color'
          @description='One gate row tone. The row tint is color-mix of it at 10 percent into the card, which is the same technique the pill uses.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-rp-demo {
        display: grid;
        gap: var(--space-5, 14px);
        max-width: 640px;
      }
    </style>
  </template>
}

// ═════════════════════════════════════════════════════════════════════════
// HeroSplit
// ═════════════════════════════════════════════════════════════════════════

export const DEMOS_READINESS_PANEL: Record<string, unknown> = {
  ReadinessPanel: ReadinessPanelUsage,
};
