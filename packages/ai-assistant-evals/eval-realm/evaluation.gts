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
import { eq, gt } from '@cardstack/boxel-ui/helpers';
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
        let score = this.effectivenessScore;
        if (score == null) {
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
    get costText() {
      return money(this.args.model.cost);
    }
    <template>
      <div class='result-embedded'>
        <span class={{this.tierClass}}>{{@model.effectivenessTier}}</span>
        <strong>{{@model.modelName}}</strong>
        <span class='meta'>{{@model.verdict}}
          ·
          {{@model.turnsCount}}
          turns ·
          {{this.costText}}</span>
      </div>
      <style scoped>
        .result-embedded {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
        }
        .meta {
          color: var(--boxel-450);
          font: var(--boxel-font-sm);
        }
        .tier {
          padding: 0 var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          background: var(--boxel-200);
          font: 600 var(--boxel-font-xs);
          text-transform: uppercase;
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
    get totalCostText() {
      return money(this.args.model.totalCost);
    }
    get rows() {
      return (this.args.model.results ?? []).map((result) => ({
        result,
        tierClass: `tier tier-${result.effectivenessTier ?? 'pending'}`,
        cost: money(result.cost),
        cache: percent(result.cachingRate),
        time: seconds(result.durationSeconds),
        quality:
          result.qualityScore == null ? '–' : String(result.qualityScore),
        score:
          result.effectivenessScore == null
            ? '–'
            : String(result.effectivenessScore),
      }));
    }
    <template>
      <article class='report'>
        <header>
          <h1><@fields.cardTitle /></h1>
          <p class='meta'>
            {{#if @model.startedAt}}<@fields.startedAt @format='atom' />
              ·
            {{/if}}
            {{@model.results.length}}
            results · total cost
            <strong>{{this.totalCostText}}</strong>
          </p>
          {{#if @model.evalCard}}
            <p class='meta'>Evaluation: <@fields.evalCard @format='atom' /></p>
          {{/if}}
        </header>

        {{#if (gt @model.results.length 0)}}
          <div class='table-wrap'>
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Model</th>
                  <th>Verdict</th>
                  <th>Quality</th>
                  <th>Score</th>
                  <th>Turns</th>
                  <th>Cost</th>
                  <th>Cache</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {{#each this.rows as |row|}}
                  <tr>
                    <td><span
                        class={{row.tierClass}}
                      >{{row.result.effectivenessTier}}</span></td>
                    <td>
                      <strong>{{row.result.modelName}}</strong>
                      {{#if row.result.reasoningEffort}}
                        <span
                          class='meta'
                        >({{row.result.reasoningEffort}})</span>
                      {{/if}}
                    </td>
                    <td>{{row.result.verdict}}</td>
                    <td>{{row.quality}}</td>
                    <td>{{row.score}}</td>
                    <td>{{row.result.turnsCount}}</td>
                    <td>{{row.cost}}</td>
                    <td>{{row.cache}}</td>
                    <td>{{row.time}}</td>
                  </tr>
                {{/each}}
              </tbody>
            </table>
          </div>
          <section class='details'>
            <h2>Results</h2>
            <@fields.results @format='embedded' />
          </section>
        {{else}}
          <p class='meta'>No results for session
            <code>{{@model.sessionId}}</code>
            yet.</p>
        {{/if}}

        {{#if (gt @model.requestedModels.length 0)}}
          <p class='meta'>Requested models:
            {{#each @model.requestedModels as |name index|}}{{if
                (eq index 0)
                ''
                ', '
              }}{{name}}{{/each}}</p>
        {{/if}}
      </article>

      <style scoped>
        .report {
          padding: var(--boxel-sp-lg);
          display: grid;
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
        .table-wrap {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font: var(--boxel-font-sm);
        }
        th,
        td {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-bottom: 1px solid var(--boxel-200);
          text-align: left;
          white-space: nowrap;
        }
        th {
          color: var(--boxel-450);
          font: 600 var(--boxel-font-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .tier {
          padding: 0 var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          background: var(--boxel-200);
          font: 600 var(--boxel-font-xs);
          text-transform: uppercase;
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
        .details {
          display: grid;
          gap: var(--boxel-sp-xs);
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
