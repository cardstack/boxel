import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { type CardContext } from 'https://cardstack.com/base/card-api';
import { codeRef, type Query } from '@cardstack/runtime-common';
import { eq } from '@cardstack/boxel-ui/helpers';
import type { SurveyQuestion } from '../../survey-question';

/* @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS */
const here: string = import.meta.url;
const surveyResponseRef = codeRef(
  here,
  '../../survey-response',
  'SurveyResponse',
);

interface AnswerLike {
  prompt?: string;
  response?: string;
}
interface ResponseLike {
  surveyId?: string;
  answers?: AnswerLike[];
}
interface OptionTally {
  label: string;
  count: number;
  pct: number;
}
interface Aggregate {
  prompt: string;
  kind: string;
  count: number;
  options: OptionTally[];
  average: number | null;
  texts: string[];
}

interface SurveyResultsSignature {
  Args: {
    surveyId: string | undefined;
    questions: SurveyQuestion[];
    realms: string[];
    context?: CardContext;
  };
  Element: HTMLElement;
}

export default class SurveyResults extends GlimmerComponent<SurveyResultsSignature> {
  get query(): Query {
    return {
      filter: {
        on: surveyResponseRef,
        eq: { surveyId: this.args.surveyId ?? '__no_survey__' },
      },
    };
  }

  search = this.args.context?.getCards(
    this,
    () => this.query,
    () => this.args.realms,
    { isLive: true },
  );

  get responses(): ResponseLike[] {
    return (this.search?.instances ?? []) as unknown as ResponseLike[];
  }

  get isLoading(): boolean {
    return Boolean(this.search?.isLoading);
  }

  get count(): number {
    return this.responses.length;
  }

  private valuesFor(prompt: string): string[] {
    let out: string[] = [];
    for (let r of this.responses) {
      let answer = (r.answers ?? []).find((a) => a.prompt === prompt);
      let v = answer?.response;
      if (v != null && v !== '' && v !== '—') out.push(v);
    }
    return out;
  }

  private tally(values: string[]): OptionTally[] {
    let total = values.length;
    let counts = new Map<string, number>();
    for (let v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        pct: total ? Math.round((count / total) * 100) : 0,
      }));
  }

  get aggregates(): Aggregate[] {
    return this.args.questions.map((q) => {
      let prompt = q.prompt ?? '';
      let kind = q.kind ?? 'short-text';
      let values = this.valuesFor(prompt);
      let agg: Aggregate = {
        prompt,
        kind,
        count: values.length,
        options: [],
        average: null,
        texts: [],
      };

      if (kind === 'single-choice' || kind === 'yes-no') {
        agg.options = this.tally(values);
      } else if (kind === 'multi-choice') {
        let expanded = values.flatMap((v) =>
          v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
        agg.options = this.tally(expanded);
      } else if (kind === 'rating') {
        let nums = values
          .map((v) => parseInt(v, 10))
          .filter((n) => Number.isFinite(n));
        agg.average = nums.length
          ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) /
            10
          : null;
        agg.options = [1, 2, 3, 4, 5].map((star) => {
          let count = nums.filter((n) => n === star).length;
          return {
            label: `${star}★`,
            count,
            pct: nums.length ? Math.round((count / nums.length) * 100) : 0,
          };
        });
      } else {
        agg.texts = values;
      }
      return agg;
    });
  }

  hasOptions = (agg: Aggregate): boolean => agg.options.length > 0;
  isText = (agg: Aggregate): boolean =>
    agg.kind === 'short-text' || agg.kind === 'long-text';
  barStyle = (pct: number) => htmlSafe(`width: ${pct}%;`);

  <template>
    <div class='results' ...attributes>
      <div class='results-summary'>
        <span class='results-count'>{{this.count}}</span>
        <span class='results-count-label'>
          {{if (eq this.count 1) 'response' 'responses'}}
        </span>
        {{#if this.isLoading}}<span
            class='results-loading'
          >updating…</span>{{/if}}
      </div>

      {{#if this.count}}
        <div class='results-list'>
          {{#each this.aggregates as |agg|}}
            <section class='agg'>
              <h3 class='agg-prompt'>{{if
                  agg.prompt
                  agg.prompt
                  'Untitled question'
                }}</h3>
              <p class='agg-meta'>
                {{agg.count}}
                answered
                {{#if (eq agg.kind 'rating')}}
                  {{#if agg.average}}· avg {{agg.average}} / 5{{/if}}
                {{/if}}
              </p>

              {{#if (this.isText agg)}}
                {{#if agg.texts.length}}
                  <ul class='agg-texts'>
                    {{#each agg.texts as |t|}}
                      <li>{{t}}</li>
                    {{/each}}
                  </ul>
                {{else}}
                  <p class='agg-empty'>No answers yet.</p>
                {{/if}}
              {{else if (this.hasOptions agg)}}
                <div class='agg-bars'>
                  {{#each agg.options as |opt|}}
                    <div class='agg-bar-row'>
                      <span class='agg-bar-label'>{{opt.label}}</span>
                      <span class='agg-bar-track'>
                        <span
                          class='agg-bar-fill'
                          style={{this.barStyle opt.pct}}
                        ></span>
                      </span>
                      <span class='agg-bar-val'>{{opt.pct}}% ({{opt.count}})</span>
                    </div>
                  {{/each}}
                </div>
              {{else}}
                <p class='agg-empty'>No answers yet.</p>
              {{/if}}
            </section>
          {{/each}}
        </div>
      {{else}}
        <div class='results-empty'>
          <p class='results-empty-title'>No responses yet</p>
          <p class='results-empty-sub'>Responses submitted to this survey will
            appear here.</p>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .results {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp, 1rem);
        font-family: var(
          --font-sans,
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif
        );
        color: var(--foreground, var(--boxel-dark));
      }
      .results-summary {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
      }
      .results-count {
        font-size: 2rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: var(--primary, var(--boxel-highlight));
      }
      .results-count-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .results-loading {
        margin-left: auto;
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .results-list {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp, 1rem);
      }
      .agg {
        padding: var(--boxel-sp, 1rem);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: 0.75rem;
        background: var(--card, var(--boxel-light));
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .agg-prompt {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }
      .agg-meta {
        margin: 0;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .agg-bars {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .agg-bar-row {
        display: grid;
        grid-template-columns: minmax(4rem, 8rem) 1fr auto;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.8125rem;
      }
      .agg-bar-label {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .agg-bar-track {
        height: 0.6rem;
        background: var(--muted, var(--boxel-100));
        border-radius: 999px;
        overflow: hidden;
      }
      .agg-bar-fill {
        display: block;
        height: 100%;
        background: var(--primary, var(--boxel-highlight));
        border-radius: 999px;
        transition: width 0.3s ease;
      }
      .agg-bar-val {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
      }
      .agg-texts {
        margin: 0;
        padding-left: 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.875rem;
      }
      .agg-texts li {
        color: var(--foreground, var(--boxel-dark));
      }
      .agg-empty {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--muted-foreground, var(--boxel-450));
        font-style: italic;
      }
      .results-empty {
        padding: var(--boxel-sp-xl, 2.5rem) var(--boxel-sp, 1rem);
        text-align: center;
        border: 1px dashed var(--border, var(--boxel-300));
        border-radius: 0.75rem;
      }
      .results-empty-title {
        margin: 0;
        font-weight: 700;
      }
      .results-empty-sub {
        margin: 0.25rem 0 0;
        font-size: 0.8125rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}
