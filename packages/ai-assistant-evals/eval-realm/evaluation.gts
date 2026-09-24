import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import DateTimeField from '@cardstack/base/datetime';
import enumField from '@cardstack/base/enum';
import { FileDef } from '@cardstack/base/file-api';
import LLMModelField from '@cardstack/base/llm-model';
import MarkdownField from '@cardstack/base/markdown';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';
import { gt } from '@cardstack/boxel-ui/helpers';
import ClipboardCheck from '@cardstack/boxel-icons/clipboard-check';
import ChartBar from '@cardstack/boxel-icons/chart-bar';
import FlaskConical from '@cardstack/boxel-icons/flask-conical';

// Three cards that hold an AI assistant evaluation end to end.
//
// An Evaluation is the test: the prompt to send, the criteria a judge scores
// the outcome against, and the cards and files the fresh test workspace starts
// with. The eval runner in packages/ai-assistant-evals reads it, drives the real assistant once
// per model, and writes one EvaluationResult per model plus one
// EvaluationReport per session. The report and the evaluation find their
// results through query-backed fields, so nothing has to be linked by hand.

// Turns a number into a 0..100 score: full marks at or under `best`, none at
// or over `worst`, linear in between.
function ramp(value: number | undefined | null, best: number, worst: number) {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }
  if (value <= best) {
    return 100;
  }
  if (value >= worst) {
    return 0;
  }
  return Math.round((100 * (worst - value)) / (worst - best));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function money(value: number | undefined | null) {
  return value == null ? '–' : `$${value.toFixed(3)}`;
}

function percent(value: number | undefined | null) {
  return value == null ? '–' : `${Math.round(value)}%`;
}

function seconds(value: number | undefined | null) {
  return value == null ? '–' : `${Math.round(value)} s`;
}

const TIERS = ['pending', 'failed', 'rough', 'good', 'great'] as const;
export type EffectivenessTier = (typeof TIERS)[number];

// The one place the score-to-tier thresholds live: the result card computes
// its own tier with it, and the report tints its headline number with it.
function tierForScore(score: number | undefined | null): EffectivenessTier {
  if (score == null || Number.isNaN(score)) {
    return 'pending';
  }
  if (score < 40) {
    return 'failed';
  }
  if (score < 70) {
    return 'rough';
  }
  if (score < 85) {
    return 'good';
  }
  return 'great';
}

export class EvaluationCard extends CardDef {
  static displayName = 'Evaluation';
  static icon = FlaskConical;

  // The first message sent to the assistant, in a fresh room, in Act mode.
  @field assistantPrompt = contains(TextAreaField);
  // Sent one after another once the assistant is idle after the previous one.
  // For flows that build something and then change it.
  @field followUpPrompts = containsMany(TextAreaField);
  // What a judge reads the finished room and the screenshot against. Each
  // line is one thing that must be true; the quality score comes from how
  // many hold.
  @field successCriteria = contains(MarkdownField);
  // Copied into the test workspace before the prompt goes out, at the same
  // path relative to the workspace root as they have here, so relative
  // `adoptsFrom` references between them keep working. The runner opens the
  // cards in the stack so they are part of the message context.
  @field initialCards = linksToMany(CardDef);
  @field initialFiles = linksToMany(FileDef);

  @field sessionReports = linksToMany(() => EvaluationReportCard, {
    query: {
      filter: { eq: { 'evalCard.id': '$this.id' } },
      sort: [{ by: 'startedAt', direction: 'desc' }],
      realm: '$REALM',
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='evaluation'>
        <header>
          <h1><@fields.cardTitle /></h1>
          {{#if @model.cardDescription}}
            <p class='summary'>{{@model.cardDescription}}</p>
          {{/if}}
        </header>

        <section>
          <h2>Prompt</h2>
          <pre class='prompt'>{{@model.assistantPrompt}}</pre>
          {{#if (gt @model.followUpPrompts.length 0)}}
            <h3>Follow-up prompts</h3>
            <ol class='follow-ups'>
              {{#each @model.followUpPrompts as |prompt|}}
                <li><pre class='prompt'>{{prompt}}</pre></li>
              {{/each}}
            </ol>
          {{/if}}
        </section>

        <section>
          <h2>Success criteria</h2>
          <@fields.successCriteria />
        </section>

        {{#if (gt @model.initialCards.length 0)}}
          <section>
            <h2>Initial cards</h2>
            <p class='hint'>Copied into the test workspace before the prompt.</p>
            <div class='links'>
              <@fields.initialCards @format='atom' />
            </div>
          </section>
        {{/if}}

        {{#if (gt @model.initialFiles.length 0)}}
          <section>
            <h2>Initial files</h2>
            <div class='links'>
              <@fields.initialFiles @format='atom' />
            </div>
          </section>
        {{/if}}

        <section>
          <h2>Sessions ({{@model.sessionReports.length}})</h2>
          {{#if (gt @model.sessionReports.length 0)}}
            <div class='reports'>
              <@fields.sessionReports @format='embedded' />
            </div>
          {{else}}
            <p class='hint'>No run yet. Run
              <code>/run-ai-assistant-eval {{@model.id}}</code>
              from the boxel repo.</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .evaluation {
          padding: var(--boxel-sp-lg);
          display: grid;
          gap: var(--boxel-sp-lg);
        }
        h1 {
          margin: 0;
          font: 700 var(--boxel-font-lg);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font: 600 var(--boxel-font);
        }
        h3 {
          margin: var(--boxel-sp) 0 var(--boxel-sp-xs);
          font: 600 var(--boxel-font-sm);
        }
        .summary,
        .hint {
          margin: 0;
          color: var(--boxel-450);
          font: var(--boxel-font-sm);
        }
        .prompt {
          margin: 0;
          padding: var(--boxel-sp-sm);
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
          white-space: pre-wrap;
          font: var(--boxel-font-sm);
        }
        .follow-ups {
          margin: 0;
          padding-left: var(--boxel-sp-lg);
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .links {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .reports {
          display: grid;
          gap: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='evaluation-embedded'>
        <strong><@fields.cardTitle /></strong>
        <span class='prompt'>{{@model.assistantPrompt}}</span>
      </div>
      <style scoped>
        .evaluation-embedded {
          padding: var(--boxel-sp-sm);
          display: grid;
          gap: var(--boxel-sp-xxs);
        }
        .prompt {
          color: var(--boxel-450);
          font: var(--boxel-font-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

export class EvaluationResultCard extends CardDef {
  static displayName = 'Evaluation Result';
  static icon = ClipboardCheck;

  @field evalCard = linksTo(() => EvaluationCard);
  @field sessionId = contains(StringField);
  // The model id the room actually ran with, and the name the picker showed.
  @field model = contains(LLMModelField);
  @field modelName = contains(StringField);
  @field reasoningEffort = contains(StringField);
  @field matrixRoomId = contains(StringField);
  @field testRealmUrl = contains(StringField);
  // The runner's mechanical verdict: pass, model-failure, host-failure,
  // bot-failure, runner-failure. See packages/ai-assistant-evals/README.md.
  @field verdict = contains(StringField);
  @field cardRendered = contains(BooleanField);
  @field cost = contains(NumberField, { description: 'USD' });
  @field turnsCount = contains(NumberField);
  @field cachingRate = contains(NumberField, {
    description:
      'Share of input tokens served from the prompt cache, 0 to 100, counted after the initial skill load',
  });
  // 0 to 10, given by a judge reading the room and the screenshot against
  // the evaluation's success criteria. Empty until judged.
  @field qualityScore = contains(NumberField);
  @field startedAt = contains(DateTimeField);
  @field endedAt = contains(DateTimeField);
  @field toolCalls = contains(StringField);
  @field notes = containsMany(StringField);
  @field skillsUsed = linksToMany(FileDef);
  @field screenshot = linksTo(FileDef);
  @field analysis = contains(MarkdownField);

  @field durationSeconds = contains(NumberField, {
    computeVia: function (this: EvaluationResultCard) {
      if (!this.startedAt || !this.endedAt) {
        return undefined;
      }
      return Math.round(
        (this.endedAt.getTime() - this.startedAt.getTime()) / 1000,
      );
    },
  });

  // One number, 0 to 100. Half of it is the judged quality; the rest rewards
  // getting there in few turns, cheaply, with the prompt cache working, and
  // quickly. A run that did not pass, or that a judge scored zero, is zero.
  // Empty until the quality score is in.
  @field effectivenessScore = contains(NumberField, {
    computeVia: function (this: EvaluationResultCard) {
      if (this.verdict && this.verdict !== 'pass') {
        return 0;
      }
      if (this.qualityScore == null) {
        return undefined;
      }
      if (this.qualityScore <= 0) {
        return 0;
      }
      let quality = clamp(this.qualityScore, 0, 10) * 10;
      let turns = ramp(this.turnsCount, 5, 15);
      let cost = ramp(this.cost, 0.1, 1);
      let cache = clamp(this.cachingRate ?? 0, 0, 100);
      let time = ramp(this.durationSeconds, 120, 600);
      return Math.round(
        0.5 * quality + 0.2 * turns + 0.1 * cost + 0.1 * cache + 0.1 * time,
      );
    },
  });

  @field effectivenessTier = contains(
    enumField(StringField, { options: [...TIERS] }),
    {
      computeVia: function (this: EvaluationResultCard): EffectivenessTier {
        return tierForScore(this.effectivenessScore);
      },
    },
  );

  @field cardTitle = contains(StringField, {
    computeVia: function (this: EvaluationResultCard) {
      let model = this.modelName ?? this.model ?? 'unknown model';
      let evalName = this.evalCard?.cardTitle;
      return evalName ? `${model} · ${evalName}` : model;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get tierClass() {
      return `tier tier-${this.args.model.effectivenessTier ?? 'pending'}`;
    }
    get costText() {
      return money(this.args.model.cost);
    }
    get cacheText() {
      return percent(this.args.model.cachingRate);
    }
    get durationText() {
      return seconds(this.args.model.durationSeconds);
    }
    <template>
      <article class='result'>
        <header>
          <div>
            <h1><@fields.cardTitle /></h1>
            <p class='meta'>
              Session
              <code>{{@model.sessionId}}</code>
              {{#if @model.reasoningEffort}}
                · effort
                {{@model.reasoningEffort}}
              {{/if}}
              · verdict
              <strong>{{@model.verdict}}</strong>
            </p>
          </div>
          <div class={{this.tierClass}}>
            <span class='tier-name'>{{@model.effectivenessTier}}</span>
            {{#if @model.effectivenessScore}}
              <span class='tier-score'>{{@model.effectivenessScore}}</span>
            {{/if}}
          </div>
        </header>

        <dl class='numbers'>
          <div><dt>Quality</dt><dd>{{if
                @model.qualityScore
                @model.qualityScore
                '–'
              }}
              / 10</dd></div>
          <div><dt>Turns</dt><dd>{{@model.turnsCount}}</dd></div>
          <div><dt>Cost</dt><dd>{{this.costText}}</dd></div>
          <div><dt>Cache</dt><dd>{{this.cacheText}}</dd></div>
          <div><dt>Time</dt><dd>{{this.durationText}}</dd></div>
          <div><dt>Card rendered</dt><dd>{{if
                @model.cardRendered
                'yes'
                'no'
              }}</dd></div>
        </dl>

        {{#if @model.toolCalls}}
          <p class='meta'>Tool calls: {{@model.toolCalls}}</p>
        {{/if}}

        {{#if (gt @model.notes.length 0)}}
          <section>
            <h2>Notes</h2>
            <ul>
              {{#each @model.notes as |note|}}
                <li>{{note}}</li>
              {{/each}}
            </ul>
          </section>
        {{/if}}

        <section>
          <h2>Analysis</h2>
          {{#if @model.analysis}}
            <@fields.analysis />
          {{else}}
            <p class='meta'>Not judged yet.</p>
          {{/if}}
        </section>

        {{#if @model.screenshot}}
          <section>
            <h2>Screenshot</h2>
            <@fields.screenshot @format='embedded' />
          </section>
        {{/if}}

        <section class='links'>
          <p class='meta'>Room
            <code>{{@model.matrixRoomId}}</code></p>
          <p class='meta'>Test workspace
            <code>{{@model.testRealmUrl}}</code></p>
          {{#if @model.evalCard}}
            <p class='meta'>Evaluation:
              <@fields.evalCard @format='atom' /></p>
          {{/if}}
          {{#if (gt @model.skillsUsed.length 0)}}
            <p class='meta'>Skills in the room:</p>
            <div class='skills'><@fields.skillsUsed @format='atom' /></div>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .result {
          padding: var(--boxel-sp-lg);
          display: grid;
          gap: var(--boxel-sp);
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
        }
        h1 {
          margin: 0;
          font: 700 var(--boxel-font-lg);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font: 600 var(--boxel-font);
        }
        .meta {
          margin: 0;
          color: var(--boxel-450);
          font: var(--boxel-font-sm);
        }
        .tier {
          display: grid;
          justify-items: center;
          min-width: 5rem;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius);
          background: var(--boxel-200);
          color: var(--boxel-dark);
        }
        .tier-name {
          font: 600 var(--boxel-font-sm);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .tier-score {
          font: 700 var(--boxel-font-lg);
        }
        .tier-great {
          background: #d3f5e2;
        }
        .tier-good {
          background: #e6f5d3;
        }
        .tier-rough {
          background: #fff0c2;
        }
        .tier-failed {
          background: #ffd6d6;
        }
        .numbers {
          margin: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
          gap: var(--boxel-sp-sm);
        }
        .numbers div {
          padding: var(--boxel-sp-sm);
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
        }
        dt {
          color: var(--boxel-450);
          font: var(--boxel-font-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        dd {
          margin: 0;
          font: 600 var(--boxel-font);
        }
        ul {
          margin: 0;
          padding-left: var(--boxel-sp-lg);
        }
        .skills {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get tierClass() {
      return `tier tier-${this.args.model.effectivenessTier ?? 'pending'}`;
    }
    get verdictClass() {
      return this.args.model.verdict === 'pass'
        ? 'verdict verdict-pass'
        : 'verdict verdict-off';
    }
    get hasScore() {
      return this.args.model.effectivenessScore != null;
    }
    get qualityText() {
      return this.args.model.qualityScore == null
        ? '–'
        : `${this.args.model.qualityScore}/10`;
    }
    get turnsText() {
      return this.args.model.turnsCount == null
        ? '–'
        : String(this.args.model.turnsCount);
    }
    get costText() {
      return money(this.args.model.cost);
    }
    get cacheText() {
      return percent(this.args.model.cachingRate);
    }
    get durationText() {
      return seconds(this.args.model.durationSeconds);
    }
    <template>
      <div class='row'>
        <div class={{this.tierClass}}>
          {{#if this.hasScore}}
            <span class='tier-score'>{{@model.effectivenessScore}}</span>
          {{/if}}
          <span class='tier-name'>{{@model.effectivenessTier}}</span>
        </div>

        <div class='who'>
          <span class='model'>{{@model.modelName}}</span>
          <span class={{this.verdictClass}}>
            {{@model.verdict}}
            {{#if @model.reasoningEffort}}
              <span class='effort'>· {{@model.reasoningEffort}} effort</span>
            {{/if}}
          </span>
        </div>

        <dl class='metrics'>
          <div><dd>{{this.qualityText}}</dd><dt>Quality</dt></div>
          <div><dd>{{this.turnsText}}</dd><dt>Turns</dt></div>
          <div><dd>{{this.costText}}</dd><dt>Cost</dt></div>
          <div><dd>{{this.cacheText}}</dd><dt>Cache</dt></div>
          <div><dd>{{this.durationText}}</dd><dt>Time</dt></div>
        </dl>
      </div>

      <style scoped>
        .row {
          --ink: #16151a;
          --ink-soft: #6b6976;
          --line: #e7e5ee;

          box-sizing: border-box;
          width: 100%;
          height: 100%;
          padding: 0.75rem 1rem;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.75rem 1rem;
          background: #fff;
          color: var(--ink);
          font-size: 0.875rem;
          line-height: 1.4;
        }

        .tier {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 3.75rem;
          padding: 0.25rem 0.5rem;
          border-radius: 0.5rem;
          background: #eeedf3;
          color: var(--ink-soft);
        }
        .tier-score {
          font-size: 1.125rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .tier-name {
          font-size: 0.5625rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .tier-great {
          background: #e2f7ea;
          color: #14663a;
        }
        .tier-good {
          background: #ecf6dd;
          color: #47661a;
        }
        .tier-rough {
          background: #fdf1d1;
          color: #7a5400;
        }
        .tier-failed {
          background: #fde4e2;
          color: #8d231f;
        }

        .who {
          flex: 1 1 11rem;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
        }
        .model {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .verdict {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
        }
        .verdict::before {
          content: '';
          width: 0.4375rem;
          height: 0.4375rem;
          border-radius: 50%;
          background: currentcolor;
        }
        .verdict-pass {
          color: #1f7a4a;
        }
        .verdict-off {
          color: #b3312b;
        }
        .effort {
          color: var(--ink-soft);
        }

        .metrics {
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem 1.25rem;
        }
        .metrics > div {
          display: flex;
          flex-direction: column;
          min-width: 3.25rem;
          text-align: right;
        }
        .metrics dd {
          margin: 0;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .metrics dt {
          color: var(--ink-soft);
          font-size: 0.625rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
      </style>
    </template>
  };
}

export class EvaluationReportCard extends CardDef {
  static displayName = 'Evaluation Report';
  static icon = ChartBar;

  @field evalCard = linksTo(() => EvaluationCard);
  @field sessionId = contains(StringField);
  @field startedAt = contains(DateTimeField);
  @field requestedModels = containsMany(StringField);

  @field results = linksToMany(() => EvaluationResultCard, {
    query: {
      filter: { eq: { sessionId: '$this.sessionId' } },
      sort: [{ by: 'modelName', direction: 'asc' }],
      realm: '$REALM',
    },
  });

  @field totalCost = contains(NumberField, {
    computeVia: function (this: EvaluationReportCard) {
      return (this.results ?? []).reduce(
        (sum, result) => sum + (result.cost ?? 0),
        0,
      );
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: EvaluationReportCard) {
      let evalName = this.evalCard?.cardTitle ?? 'Evaluation';
      return `${evalName} · ${this.sessionId ?? 'session'}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get results() {
      return this.args.model.results ?? [];
    }
    get evalName() {
      return this.args.model.evalCard?.cardTitle ?? 'Evaluation report';
    }
    get passText() {
      let passed = this.results.filter(
        (result) => result.verdict === 'pass',
      ).length;
      return `${passed}/${this.results.length}`;
    }
    get meanScore() {
      let scored = this.results.filter(
        (result) => result.effectivenessScore != null,
      );
      if (!scored.length) {
        return undefined;
      }
      return Math.round(
        scored.reduce(
          (sum, result) => sum + (result.effectivenessScore ?? 0),
          0,
        ) / scored.length,
      );
    }
    get meanScoreText() {
      return this.meanScore == null ? '–' : String(this.meanScore);
    }
    get leadClass() {
      return `stat stat-lead tier-${tierForScore(this.meanScore)}`;
    }
    get totalCostText() {
      return money(this.args.model.totalCost);
    }
    get totalTimeText() {
      let total = this.results.reduce(
        (sum, result) => sum + (result.durationSeconds ?? 0),
        0,
      );
      return total ? seconds(total) : '–';
    }
    <template>
      <article class='report'>
        <header class='head'>
          <div class='head-text'>
            <h1>{{this.evalName}}</h1>
            <p class='session'>
              {{#if @model.startedAt}}<@fields.startedAt @format='atom' />
                <span class='dot'>·</span>
              {{/if}}
              <code>{{@model.sessionId}}</code>
            </p>
          </div>
          {{#if @model.evalCard}}
            <div class='head-link'>
              <span class='label'>Evaluation</span>
              <@fields.evalCard @format='atom' />
            </div>
          {{/if}}
        </header>

        <dl class='stats'>
          <div class={{this.leadClass}}>
            <dd>{{this.meanScoreText}}</dd>
            <dt>Mean score</dt>
          </div>
          <div class='stat'>
            <dd>{{this.results.length}}</dd>
            <dt>Models</dt>
          </div>
          <div class='stat'>
            <dd>{{this.passText}}</dd>
            <dt>Passed</dt>
          </div>
          <div class='stat'>
            <dd>{{this.totalCostText}}</dd>
            <dt>Total cost</dt>
          </div>
          <div class='stat'>
            <dd>{{this.totalTimeText}}</dd>
            <dt>Total time</dt>
          </div>
        </dl>

        {{#if (gt @model.results.length 0)}}
          <section class='results'>
            <h2>Results</h2>
            <div class='result-list'><@fields.results
                @format='embedded'
              /></div>
          </section>
        {{else}}
          <p class='empty'>
            No results for this session yet. The runner writes one result card
            per model as each run ends.
          </p>
        {{/if}}

        {{#if (gt @model.requestedModels.length 0)}}
          <footer class='requested'>
            <span class='label'>Requested</span>
            <ul class='chips'>
              {{#each @model.requestedModels as |name|}}
                <li>{{name}}</li>
              {{/each}}
            </ul>
          </footer>
        {{/if}}
      </article>

      <style scoped>
        .report {
          --ink: #16151a;
          --ink-soft: #6b6976;
          --ink-faint: #9b98a4;
          --line: #e7e5ee;
          --sunken: #f7f6fa;
          --radius: 0.75rem;
          --radius-sm: 0.375rem;

          box-sizing: border-box;
          min-height: 100%;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          background: #fff;
          color: var(--ink);
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.2;
        }
        .session {
          margin: 0.375rem 0 0;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.375rem;
          color: var(--ink-soft);
        }
        .session code {
          padding: 0.0625rem 0.375rem;
          border-radius: var(--radius-sm);
          background: var(--sunken);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.8125rem;
        }
        .dot {
          color: var(--ink-faint);
        }
        .head-link {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .label {
          color: var(--ink-faint);
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .stats {
          margin: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
          gap: 0.75rem;
        }
        .stat {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          padding: 0.875rem 1rem;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          background: var(--sunken);
        }
        .stat dd {
          margin: 0;
          font-size: 1.375rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
        }
        .stat dt {
          color: var(--ink-soft);
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .stat-lead {
          border-color: transparent;
        }
        .stat-lead dd {
          font-size: 1.75rem;
        }
        .stat-lead dt {
          color: inherit;
          opacity: 0.75;
        }
        .tier-great {
          background: #e2f7ea;
          color: #14663a;
        }
        .tier-good {
          background: #ecf6dd;
          color: #47661a;
        }
        .tier-rough {
          background: #fdf1d1;
          color: #7a5400;
        }
        .tier-failed {
          background: #fde4e2;
          color: #8d231f;
        }
        .tier-pending {
          background: var(--sunken);
          color: var(--ink-soft);
        }

        .results {
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
        }
        h2 {
          margin: 0;
          color: var(--ink-soft);
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .result-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .empty {
          margin: 0;
          padding: 1.5rem;
          border: 1px dashed var(--line);
          border-radius: var(--radius);
          color: var(--ink-soft);
          text-align: center;
        }

        .requested {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          padding-top: 1rem;
          border-top: 1px solid var(--line);
        }
        .chips {
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          list-style: none;
        }
        .chips li {
          padding: 0.125rem 0.5rem;
          border: 1px solid var(--line);
          border-radius: 1rem;
          color: var(--ink-soft);
          font-size: 0.75rem;
        }
      </style>
    </template>
  };

  // Shown inside the evaluation's session list, where this card's own
  // query-backed `results` do not resolve; it names what the report holds
  // and leaves the numbers to the isolated view.
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='report-embedded'>
        <strong>{{@model.sessionId}}</strong>
        <span class='meta'>
          {{#if @model.startedAt}}<@fields.startedAt @format='atom' />
            ·
          {{/if}}
          {{@model.requestedModels.length}}
          model(s) requested
        </span>
      </div>
      <style scoped>
        .report-embedded {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
        }
        .meta {
          color: var(--boxel-450);
          font: var(--boxel-font-sm);
        }
      </style>
    </template>
  };
}
