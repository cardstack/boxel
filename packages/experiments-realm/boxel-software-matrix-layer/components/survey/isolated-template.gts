import { Component, realmURL } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import type { Survey } from '../../survey';
import type { SurveyQuestion } from '../../survey-question';
import { SurveyResponse, SurveyAnswer } from '../../survey-response';
import FormWizard from './form-wizard';
import type { WizardStep } from './form-wizard';
import QuestionInput from './question-input';
import SurveyResults from './survey-results';

interface PageItem {
  question: SurveyQuestion;
  index: number;
}

const PAGE_SIZE = 4;

export class SurveyIsolated extends Component<typeof Survey> {
  @tracked currentStep = 0;
  @tracked answers: Record<number, unknown> = {};
  @tracked submitted = false;
  @tracked showErrors = false;
  @tracked saving = false;
  @tracked submitNote = '';
  @tracked mode: 'fill' | 'results' = 'fill';

  get questions(): SurveyQuestion[] {
    return (this.args.model?.questions as SurveyQuestion[] | undefined) ?? [];
  }

  get surveyRealm(): string | undefined {
    let url = this.args.model?.[realmURL];
    return url ? url.href : undefined;
  }

  get resultRealms(): string[] {
    return this.surveyRealm ? [this.surveyRealm] : [];
  }

  get pages(): PageItem[][] {
    let pages: PageItem[][] = [];
    this.questions.forEach((question, index) => {
      let page = Math.floor(index / PAGE_SIZE);
      (pages[page] ??= []).push({ question, index });
    });
    return pages;
  }

  get steps(): WizardStep[] {
    let pageSteps = this.pages.map((_, i) => ({ label: `Page ${i + 1}` }));
    return [...pageSteps, { label: 'Review' }];
  }

  get isReview(): boolean {
    return this.currentStep >= this.pages.length;
  }

  get activePageItems(): PageItem[] {
    return this.pages[this.currentStep] ?? [];
  }

  get answeredCount(): number {
    return this.questions.filter((_, index) => this.hasAnswer(index)).length;
  }

  get progressPct(): number {
    let total = this.questions.length;
    if (!total) return 0;
    return Math.round((this.answeredCount / total) * 100);
  }

  get progressStyle() {
    return htmlSafe(`width: ${this.progressPct}%;`);
  }

  get currentPageInvalid(): boolean {
    return (
      !this.isReview &&
      this.activePageItems.some(
        (it) => it.question.required && !this.hasAnswer(it.index),
      )
    );
  }

  get allRequiredMet(): boolean {
    return this.questions.every(
      (q, index) => !q.required || this.hasAnswer(index),
    );
  }

  hasAnswer(index: number): boolean {
    let v = this.answers[index];
    if (v == null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }

  answerFor = (index: number): unknown => {
    return this.answers[index];
  };

  isInvalid = (question: SurveyQuestion, index: number): boolean => {
    return Boolean(
      this.showErrors && question.required && !this.hasAnswer(index),
    );
  };

  questionNumber = (index: number): string => {
    return `Q${index + 1} of ${this.questions.length}`;
  };

  displayAnswer = (index: number): string => {
    let v = this.answers[index];
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return `${v} / 5`;
    return String(v);
  };

  private pageOf(index: number): number {
    return Math.floor(index / PAGE_SIZE);
  }

  private firstUnmetPage(): number | null {
    let q = this.questions.findIndex(
      (question, index) => question.required && !this.hasAnswer(index),
    );
    return q === -1 ? null : this.pageOf(q);
  }

  @action
  setAnswer(index: number, value: unknown) {
    this.answers = { ...this.answers, [index]: value };
  }

  @action
  setMode(mode: 'fill' | 'results') {
    this.mode = mode;
  }

  @action
  goToStep(index: number) {
    this.submitted = false;
    this.showErrors = false;
    this.currentStep = index;
  }

  @action
  editAnswer(index: number) {
    this.goToStep(this.pageOf(index));
  }

  @action
  previous() {
    this.showErrors = false;
    if (this.currentStep > 0) this.currentStep -= 1;
  }

  @action
  next() {
    if (this.isReview) {
      this.submit();
      return;
    }
    if (this.currentPageInvalid) {
      this.showErrors = true;
      return;
    }
    this.showErrors = false;
    this.currentStep += 1;
  }

  @action
  onKeydown(event: Event) {
    let ke = event as KeyboardEvent;
    let target = event.target as HTMLElement;
    if (ke.key !== 'Enter' || target.tagName === 'TEXTAREA') return;
    event.preventDefault();
    this.next();
  }

  @action
  async submit() {
    if (!this.allRequiredMet) {
      this.showErrors = true;
      let page = this.firstUnmetPage();
      if (page != null) this.currentStep = page;
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.submitNote =
        'Open this survey in the full app to save responses. Your answers are shown below.';
      this.submitted = true;
      return;
    }

    let realm = this.surveyRealm;
    if (!realm) {
      this.submitNote =
        'This survey has not been saved yet, so responses cannot be collected. Your answers are shown below.';
      this.submitted = true;
      return;
    }

    this.saving = true;
    this.submitNote = '';
    try {
      let answers = this.questions.map(
        (q, index) =>
          new SurveyAnswer({
            prompt: q.prompt ?? `Question ${index + 1}`,
            response: this.displayAnswer(index),
          }),
      );
      let response = new SurveyResponse({
        surveyId: this.args.model.id,
        surveyTitle: this.args.model.title ?? 'Survey',
        answers,
      });
      response.survey = this.args.model as unknown as Survey;
      await new SaveCardCommand(commandContext).execute({
        card: response,
        realm,
      });
    } catch (err) {
      this.submitNote = `Your answers are shown below, but the response couldn't be saved (${
        (err as Error)?.message ?? 'unknown error'
      }). If this is someone else's survey, you may not have write access to its workspace.`;
    } finally {
      this.saving = false;
      this.submitted = true;
    }
  }

  @action
  restart() {
    this.answers = {};
    this.currentStep = 0;
    this.submitted = false;
    this.showErrors = false;
    this.submitNote = '';
  }

  <template>
    <section class='survey'>
      <header class='survey-header'>
        <div class='survey-head-top'>
          <p class='survey-eyebrow'>Survey</p>
          <div class='survey-modes' role='tablist'>
            <button
              type='button'
              role='tab'
              class='survey-mode {{if (eq this.mode "fill") "is-active"}}'
              aria-selected={{if (eq this.mode 'fill') 'true' 'false'}}
              {{on 'click' (fn this.setMode 'fill')}}
            >Fill</button>
            <button
              type='button'
              role='tab'
              class='survey-mode {{if (eq this.mode "results") "is-active"}}'
              aria-selected={{if (eq this.mode 'results') 'true' 'false'}}
              {{on 'click' (fn this.setMode 'results')}}
            >Results</button>
          </div>
        </div>
        <h1 class='survey-title'>
          {{if @model.title @model.title 'Untitled survey'}}
        </h1>
        {{#if @model.description}}
          <div class='survey-desc'><@fields.description /></div>
        {{/if}}
        {{#unless (eq this.mode 'results')}}
          <div class='survey-progress'>
            <div class='survey-progress-track'>
              <div
                class='survey-progress-fill'
                style={{this.progressStyle}}
              ></div>
            </div>
            <span class='survey-progress-label'>
              {{this.answeredCount}}
              of
              {{this.questions.length}}
              answered
            </span>
          </div>
        {{/unless}}
      </header>

      {{#if (eq this.mode 'results')}}
        <SurveyResults
          @surveyId={{@model.id}}
          @questions={{this.questions}}
          @realms={{this.resultRealms}}
          @context={{@context}}
        />
      {{else if this.submitted}}
        <div class='survey-done'>
          <div class='survey-done-check'>✓</div>
          <h2>Thanks for completing the survey!</h2>
          <p class='survey-done-sub'>You answered
            {{this.answeredCount}}
            of
            {{this.questions.length}}
            questions.</p>
          {{#if this.submitNote}}
            <p class='survey-done-note'>{{this.submitNote}}</p>
          {{/if}}
          <dl class='survey-done-list'>
            {{#each this.questions as |question index|}}
              <div class='survey-done-row'>
                <dt>{{if
                    question.prompt
                    question.prompt
                    'Untitled question'
                  }}</dt>
                <dd>{{this.displayAnswer index}}</dd>
              </div>
            {{/each}}
          </dl>
          <button
            type='button'
            class='survey-restart'
            {{on 'click' this.restart}}
          >
            Start over
          </button>
        </div>
      {{else}}
        <FormWizard
          @steps={{this.steps}}
          @activeIndex={{this.currentStep}}
          @onSelect={{this.goToStep}}
          @onPrevious={{this.previous}}
          @onNext={{this.next}}
          @finishLabel={{if this.saving 'Submitting…' 'Submit'}}
        >
          {{#if this.isReview}}
            <div class='survey-review'>
              <h2 class='survey-review-title'>Review your answers</h2>
              {{#unless this.allRequiredMet}}
                <p class='survey-review-warn'>Some required questions still need
                  an answer.</p>
              {{/unless}}
              {{#each this.questions as |question index|}}
                <button
                  type='button'
                  class='survey-review-row
                    {{if (this.isInvalid question index) "is-invalid"}}'
                  {{on 'click' (fn this.editAnswer index)}}
                >
                  <span class='survey-review-q'>
                    {{if question.prompt question.prompt 'Untitled question'}}
                    {{#if question.required}}<span
                        class='survey-q-req'
                      >*</span>{{/if}}
                  </span>
                  <span class='survey-review-a'>{{this.displayAnswer
                      index
                    }}</span>
                  <span class='survey-review-edit'>Edit</span>
                </button>
              {{/each}}
            </div>
          {{else}}
            {{! Delegated keydown: the handler only reads Enter bubbling up
                from the focusable inputs inside; the div itself is never a
                tab stop. }}
            {{! template-lint-disable no-invalid-interactive }}
            <div class='survey-questions' {{on 'keydown' this.onKeydown}}>
              {{#each this.activePageItems as |item idx|}}
                <fieldset class='survey-question'>
                  <div class='survey-q-num'>{{this.questionNumber
                      item.index
                    }}</div>
                  <legend class='survey-q-prompt'>
                    {{if
                      item.question.prompt
                      item.question.prompt
                      'Untitled question'
                    }}
                    {{#if item.question.required}}<span
                        class='survey-q-req'
                      >*</span>{{/if}}
                  </legend>
                  {{#if item.question.helpText}}
                    <p class='survey-q-help'>{{item.question.helpText}}</p>
                  {{/if}}
                  <QuestionInput
                    @question={{item.question}}
                    @value={{this.answerFor item.index}}
                    @onChange={{fn this.setAnswer item.index}}
                    @autofocus={{eq idx 0}}
                    @invalid={{this.isInvalid item.question item.index}}
                  />
                  {{#if (this.isInvalid item.question item.index)}}
                    <p class='survey-q-error'>This question is required.</p>
                  {{/if}}
                </fieldset>
              {{/each}}
            </div>
          {{/if}}
        </FormWizard>
      {{/if}}
    </section>

    <style scoped>
      .survey {
        --survey-accent: var(--primary, var(--boxel-highlight));
        container-type: inline-size;
        max-width: 52rem;
        margin: 0 auto;
        padding: var(--boxel-sp-lg, 1.5rem);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg, 1.5rem);
        color: var(--foreground, var(--boxel-dark));
        font-family: var(
          --font-sans,
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif
        );
      }
      .survey-header {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .survey-head-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .survey-modes {
        display: inline-flex;
        padding: 0.15rem;
        gap: 0.15rem;
        background: var(--muted, var(--boxel-100));
        border-radius: 999px;
      }
      .survey-mode {
        padding: 0.3rem 0.85rem;
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
        background: transparent;
        border: none;
        border-radius: 999px;
        cursor: pointer;
      }
      .survey-mode.is-active {
        background: var(--card, var(--boxel-light));
        color: var(--survey-accent);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      }
      .survey-eyebrow {
        margin: 0;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--survey-accent);
      }
      .survey-title {
        margin: 0;
        font-size: 1.6rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .survey-desc {
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 0.95rem;
      }
      .survey-progress {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.4rem;
      }
      .survey-progress-track {
        flex: 1;
        height: 0.5rem;
        background: var(--muted, var(--boxel-100));
        border-radius: 999px;
        overflow: hidden;
      }
      .survey-progress-fill {
        height: 100%;
        background: var(--survey-accent);
        border-radius: 999px;
        transition: width 0.25s ease;
      }
      .survey-progress-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
      }

      .survey-questions {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp, 1rem);
      }
      .survey-question {
        margin: 0;
        padding: var(--boxel-sp, 1rem);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: 0.75rem;
        background: var(--card, var(--boxel-light));
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .survey-q-num {
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--survey-accent);
      }
      .survey-q-prompt {
        padding: 0;
        font-size: 1rem;
        font-weight: 600;
      }
      .survey-q-req {
        color: var(--destructive, var(--boxel-danger));
        margin-left: 0.15rem;
      }
      .survey-q-help {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .survey-q-error {
        margin: 0;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--destructive, var(--boxel-danger));
      }

      .survey-review {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .survey-review-title {
        margin: 0 0 0.25rem;
        font-size: 1.1rem;
        font-weight: 700;
      }
      .survey-review-warn {
        margin: 0 0 0.25rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: color-mix(
          in oklch,
          var(--boxel-warning) 38%,
          var(--foreground, var(--boxel-dark))
        );
      }
      .survey-review-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: var(--boxel-sp, 1rem);
        width: 100%;
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: 0.5rem;
        background: var(--card, var(--boxel-light));
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          background 0.15s ease;
      }
      .survey-review-row:hover {
        border-color: var(--survey-accent);
        background: color-mix(in srgb, var(--survey-accent) 6%, transparent);
      }
      .survey-review-row.is-invalid {
        border-color: var(--destructive, var(--boxel-danger));
      }
      .survey-review-q {
        font-weight: 600;
        min-width: 0;
      }
      .survey-review-a {
        color: var(--survey-accent);
        font-weight: 600;
        text-align: right;
      }
      .survey-review-edit {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-450));
      }

      .survey-done {
        text-align: center;
        padding: var(--boxel-sp-xl, 2.5rem) var(--boxel-sp);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
      }
      .survey-done-check {
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.75rem;
        font-weight: 800;
        color: var(--boxel-light);
        background: var(--boxel-success);
        margin-bottom: 0.5rem;
      }
      .survey-done h2 {
        margin: 0;
      }
      .survey-done-sub {
        margin: 0;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .survey-done-note {
        margin: 0;
        font-size: 0.8125rem;
        color: color-mix(
          in oklch,
          var(--boxel-warning) 38%,
          var(--foreground, var(--boxel-dark))
        );
      }
      .survey-done-list {
        margin: 0.75rem 0 0;
        width: 100%;
        max-width: 34rem;
        display: grid;
        gap: 0.4rem;
        text-align: left;
      }
      .survey-done-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--boxel-sp, 1rem);
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: 0.5rem;
      }
      .survey-done-row dt {
        font-weight: 600;
        min-width: 0;
      }
      .survey-done-row dd {
        margin: 0;
        font-weight: 600;
        color: var(--survey-accent);
        text-align: right;
      }
      .survey-restart {
        margin-top: 0.75rem;
        padding: 0.5rem 1.1rem;
        font: inherit;
        font-weight: 600;
        color: var(--survey-accent);
        background: transparent;
        border: 1px solid var(--survey-accent);
        border-radius: 0.5rem;
        cursor: pointer;
      }
    </style>
  </template>
}
