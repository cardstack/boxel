import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';
import AuthedFetchCommand from '@cardstack/boxel-host/commands/authed-fetch';
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  FieldDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

const BXL_TOKEN_RE = new RegExp(
  '(#.*$)|("(?:\\\\.|[^"\\\\])*")|\\b(true|false|null)\\b|\\b(assert|append|prepend|del|card|select|any|all|and|or|reorder_by|insert_item_before|insert_item_after|move_item_before|move_item_after|move_item_to_start|move_item_to_end|copy_value_to)\\b|(-?\\d+(?:\\.\\d+)?)|([.|=+*;{}()\\[\\]])',
  'gm',
);
const BXL_ERROR_PREFIX_RE = new RegExp(
  '^BXL mutation [^ ]+ error \\([^)]+\\):\\s*',
);

function escapeHtml(value: string): string {
  return value
    .replace(new RegExp('&', 'g'), '&amp;')
    .replace(new RegExp('<', 'g'), '&lt;')
    .replace(new RegExp('>', 'g'), '&gt;');
}

function highlightBxl(source: string | undefined) {
  let escaped = '';
  let lastIndex = 0;
  for (let match of source?.matchAll(BXL_TOKEN_RE) ?? []) {
    let index = match.index ?? 0;
    escaped += escapeHtml((source ?? '').slice(lastIndex, index));
    let kind = match[1]
      ? 'comment'
      : match[2]
        ? 'string'
        : match[3]
          ? 'literal'
          : match[4]
            ? 'function'
            : match[5]
              ? 'number'
              : 'operator';
    escaped += `<span class="bxl-${kind}">${escapeHtml(match[0])}</span>`;
    lastIndex = index + match[0].length;
  }
  escaped += escapeHtml((source ?? '').slice(lastIndex));
  return htmlSafe(escaped);
}

export class ClinicalMutationScenario extends FieldDef {
  static displayName = 'Clinical mutation scenario';

  @field level = contains(StringField);
  @field pattern = contains(StringField);
  @field title = contains(StringField);
  @field intent = contains(StringField);
  @field techniques = containsMany(StringField);
  @field viewerPartyId = contains(StringField);
  @field viewerLabel = contains(StringField);
  @field applySource = contains(StringField);
  @field resetSource = contains(StringField);
}

export class ClinicalMutationWorkbench extends CardDef {
  static displayName = 'BXL Clinical Mutation Workbench';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field scenarios = containsMany(ClinicalMutationScenario);
  @field target = linksTo(CardDef);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ClinicalMutationWorkbench) {
      return this.title ?? 'BXL Clinical Mutation Atlas';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function () {
      return 'Ten surgical BXL operations in one interactive clinical card';
    },
  });

  static isolated = class Isolated extends Component<
    typeof ClinicalMutationWorkbench
  > {
    @tracked selectedScenarioIndex = 0;
    @tracked state: 'idle' | 'running' | 'success' | 'error' = 'idle';
    @tracked feedback =
      'Choose an operation, apply it, then reverse it against the live patient record.';
    workbenchElement: HTMLElement | null = null;

    get scenario() {
      return this.args.model.scenarios?.[this.selectedScenarioIndex];
    }

    get commandContext() {
      let args = this.args as any;
      return (
        args.context?.commandContext ??
        args.context?.actions?.commandContext ??
        null
      );
    }

    get realmURL() {
      let id = this.args.model.id;
      if (!id) return '';
      let url = new URL(id);
      let segments = url.pathname.split('/').filter(Boolean);
      return `${url.origin}/${segments.slice(0, -2).join('/')}/`;
    }

    get isRunning() {
      return this.state === 'running';
    }

    openReviewerGuide = () => {
      if (!this.realmURL) return;
      this.args.viewCard?.(
        new URL('reviewers-guide.md', this.realmURL),
        'isolated',
        { type: 'file' },
      );
    };

    get highlightedApplySource() {
      return highlightBxl(this.scenario?.applySource);
    }

    get highlightedResetSource() {
      return highlightBxl(this.scenario?.resetSource);
    }

    get resultFocus() {
      return [
        { section: 'signals', label: 'acuity, vitals, and audit state' },
        { section: 'medications', label: 'Warfarin dose and medication state' },
        { section: 'medications', label: 'the complete medication list' },
        { section: 'billing', label: 'billing values and computed total' },
        { section: 'daily-care', label: 'the ordered daily-care plan' },
        { section: 'daily-care', label: 'the ordered daily-care plan' },
        { section: 'clinical-summary', label: 'the discharge-summary draft' },
        { section: 'consultants', label: 'the ordered consultant links' },
        {
          section: 'care-contacts',
          label: 'care contacts and nested person link',
        },
        { section: 'signals', label: 'the complete ICU transfer state' },
      ][this.selectedScenarioIndex];
    }

    focusResult = () => {
      let frame = this.workbenchElement?.querySelector<HTMLElement>(
        '.clinical-mutation-target-frame',
      );
      let section = frame?.querySelector<HTMLElement>(
        `[data-clinical-section="${this.resultFocus?.section}"]`,
      );
      if (!frame || !section) return;
      let top =
        section.getBoundingClientRect().top -
        frame.getBoundingClientRect().top +
        frame.scrollTop -
        12;
      frame.scrollTo({ top, behavior: 'smooth' });
    };

    setScenarioViewer = () => {
      let target = this.args.model.target as CardDef & {
        setDemoViewer?: (partyId: string) => void;
      };
      let partyId = this.scenario?.viewerPartyId;
      if (partyId && target?.setDemoViewer) {
        target.setDemoViewer(partyId);
      }
    };

    rememberWorkbench(event: Event) {
      this.workbenchElement = (event.currentTarget as HTMLElement).closest(
        '.workbench',
      );
    }

    selectScenario = (event: Event) => {
      this.rememberWorkbench(event);
      let value = (event.currentTarget as HTMLElement).dataset.scenarioIndex;
      this.selectedScenarioIndex = Number(value ?? 0);
      this.state = 'idle';
      this.feedback =
        'Apply this operation, then reverse it against the live patient record.';
      this.setScenarioViewer();
      requestAnimationFrame(this.focusResult);
    };

    messageFromBody(body: any, fallback: string) {
      let message =
        body?.errors?.[0]?.detail ??
        body?.errors?.[0]?.message ??
        body?.errors?.[0]?.title ??
        body?.message ??
        body?.rawText ??
        fallback;
      return String(message).replace(BXL_ERROR_PREFIX_RE, '');
    }

    run = async (direction: 'apply' | 'reset', event: Event) => {
      if (this.isRunning) return;
      this.rememberWorkbench(event);
      this.state = 'running';
      this.feedback =
        direction === 'apply'
          ? 'Applying BXL directly to the persisted clinical JSON source…'
          : 'Reversing this operation with BXL…';

      try {
        let commandContext = this.commandContext;
        let target = this.args.model.target?.id;
        let source =
          direction === 'apply'
            ? this.scenario?.applySource
            : this.scenario?.resetSource;
        if (!commandContext || !target || !source || !this.realmURL) {
          throw new Error('The workbench is missing its command context.');
        }

        let result = await new AuthedFetchCommand(commandContext).execute({
          url: `${this.realmURL}_mutate`,
          method: 'POST',
          acceptHeader: 'application/vnd.card+json',
          contentType: 'application/json',
          requestBody: JSON.stringify({
            href: target,
            source,
            syntax: 'solidified',
            programId: `clinical-workbench:${direction}:${Date.now()}`,
          }),
        });

        if (!result.ok) {
          throw new Error(
            this.messageFromBody(
              result.body,
              `Clinical mutation failed with HTTP ${result.status}`,
            ),
          );
        }

        this.state = 'success';
        this.feedback =
          direction === 'apply'
            ? 'Applied. The exact target refreshes from its Matrix index event.'
            : 'Reversed. The synthetic patient record is back at baseline.';
        requestAnimationFrame(this.focusResult);
        setTimeout(() => {
          this.setScenarioViewer();
          this.focusResult();
        }, 750);
      } catch (error: any) {
        this.state = 'error';
        this.feedback = error?.message ?? String(error);
      }
    };

    apply = (event: Event) => this.run('apply', event);
    reset = (event: Event) => this.run('reset', event);

    <template>
      <main class='workbench'>
        <section class='scenario' aria-label='Clinical mutation scenario'>
          <nav class='toc' aria-label='Mutation operation table of contents'>
            <div class='toc-heading'>
              <span class='eyebrow'>One card · ten operations</span>
              <h1>{{@model.title}}</h1>
              <button
                type='button'
                class='reviewer-guide-link'
                {{on 'click' this.openReviewerGuide}}
              >Reviewer’s guide <span aria-hidden='true'>↗</span></button>
            </div>
            <ol>
              {{#each @model.scenarios as |scenario index|}}
                <li>
                  <button
                    type='button'
                    class={{if
                      (eq index this.selectedScenarioIndex)
                      'toc-item toc-item--active'
                      'toc-item'
                    }}
                    data-scenario-index={{index}}
                    aria-current={{if
                      (eq index this.selectedScenarioIndex)
                      'true'
                    }}
                    {{on 'click' this.selectScenario}}
                  >
                    <span>{{scenario.level}}</span>
                    <strong>{{scenario.title}}</strong>
                    <small>{{scenario.pattern}}</small>
                  </button>
                </li>
              {{/each}}
            </ol>
          </nav>

          <header class='scenario-heading'>
            <span class='eyebrow'>{{this.scenario.level}}
              ·
              {{this.scenario.pattern}}</span>
            <h2>{{this.scenario.title}}</h2>
            <p>{{this.scenario.intent}}</p>
            <aside class='techniques' aria-label='BXL demonstrated'>
              <strong>BXL demonstrated</strong>
              <ul>
                {{#each this.scenario.techniques as |technique|}}
                  <li>{{technique}}</li>
                {{/each}}
              </ul>
            </aside>
          </header>

          <section class='controls' aria-label='Mutation controls'>
            <button
              type='button'
              class='apply'
              disabled={{this.isRunning}}
              {{on 'click' this.apply}}
            >
              {{if this.isRunning 'Working…' 'Apply operation'}}
            </button>
            <button
              type='button'
              class='reset'
              disabled={{this.isRunning}}
              {{on 'click' this.reset}}
            >
              Reverse operation
            </button>
            <p class='feedback feedback--{{this.state}}' aria-live='polite'>
              {{this.feedback}}
            </p>
          </section>

          <section class='program'>
            <strong>Apply · canonical BXL mutation</strong>
            <pre><code>{{this.highlightedApplySource}}</code></pre>
          </section>
          <section class='program'>
            <strong>Reverse · canonical BXL mutation</strong>
            <pre><code>{{this.highlightedResetSource}}</code></pre>
          </section>
        </section>

        <section class='result' aria-label='Live clinical mutation result'>
          <div class='result-heading'>
            <div>
              <span class='eyebrow'>Live indexed result</span>
              <h2>{{this.resultFocus.label}}</h2>
            </div>
            <div class='result-context'>
              <span class='result-note'>Focused from the selected operation</span>
              <span class='result-viewer'>View as ·
                {{this.scenario.viewerLabel}}</span>
            </div>
          </div>
          <div class='target-frame clinical-mutation-target-frame'>
            <@fields.target @format='isolated' />
          </div>
        </section>
      </main>

      <style scoped>
        .workbench,
        .workbench * {
          box-sizing: border-box;
        }
        .workbench {
          display: grid;
          grid-template-columns: minmax(20rem, 25rem) minmax(50rem, 1fr);
          gap: 1rem;
          min-height: 100%;
          padding: 1rem;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-sans);
        }
        .scenario {
          display: grid;
          gap: 1rem;
          align-content: start;
          min-width: 0;
        }
        .toc,
        .scenario-heading,
        .controls,
        .program,
        .result {
          border: 1px solid var(--clinical-rule-strong);
          border-radius: 0;
          background: var(--card);
        }
        .toc {
          overflow: hidden;
          border-top: 0.3rem solid var(--primary);
        }
        .toc-heading {
          padding: 1rem 1.1rem 0.85rem;
        }
        .toc-heading h1,
        .scenario-heading h2,
        .result h2,
        p {
          margin: 0;
        }
        .toc-heading h1 {
          margin-top: 0.3rem;
          font: 600 1.55rem/1.1 var(--font-serif);
        }
        .reviewer-guide-link {
          min-height: 0;
          margin-top: 0.8rem;
          padding: 0 0 0.2rem;
          border: 0;
          border-bottom: 1px solid var(--primary);
          border-radius: 0;
          background: transparent;
          color: var(--primary);
          font: 750 0.68rem/1.2 var(--font-mono);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .reviewer-guide-link span {
          margin-left: 0.25rem;
        }
        .toc ol {
          max-height: 18rem;
          margin: 0;
          padding: 0;
          overflow: auto;
          border-top: 1px solid var(--clinical-rule-strong);
          list-style: none;
        }
        .toc-item {
          width: 100%;
          display: grid;
          grid-template-columns: 2rem minmax(0, 1fr);
          gap: 0.15rem 0.6rem;
          min-height: 0;
          padding: 0.65rem 0.8rem;
          border: 0;
          border-bottom: 1px solid var(--border);
          border-radius: 0;
          background: var(--card);
          color: var(--foreground);
          text-align: left;
        }
        .toc-item > span {
          grid-row: 1 / 3;
          color: var(--primary);
          font: 800 0.7rem var(--font-mono);
        }
        .toc-item strong {
          overflow: hidden;
          font-size: 0.75rem;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .toc-item small {
          overflow: hidden;
          color: var(--muted-foreground);
          font: 0.62rem var(--font-mono);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .toc-item:hover,
        .toc-item--active {
          background: var(--clinical-accent-soft);
          color: var(--accent-foreground);
        }
        .toc-item--active {
          box-shadow: inset 0.25rem 0 var(--primary);
        }
        .scenario-heading {
          padding: 1rem 1.1rem;
        }
        .scenario-heading h2 {
          margin-top: 0.35rem;
          font: 600 1.35rem/1.15 var(--font-serif);
        }
        .scenario-heading p {
          margin-top: 0.65rem;
          color: var(--clinical-copy);
          font-size: 0.78rem;
          line-height: 1.45;
        }
        .techniques {
          margin-top: 0.85rem;
          padding: 0.7rem 0;
          border-top: 1px solid var(--clinical-rule-strong);
          border-bottom: 1px solid var(--clinical-rule-strong);
        }
        .techniques strong {
          display: block;
          color: var(--primary);
          font: 800 0.64rem var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .techniques ul {
          display: grid;
          gap: 0.25rem;
          margin: 0.55rem 0 0;
          padding: 0;
          list-style: none;
        }
        .techniques li {
          color: var(--clinical-copy);
          font-size: 0.72rem;
          line-height: 1.35;
        }
        .techniques li::before {
          content: '\2192';
          margin-right: 0.45rem;
          color: var(--primary);
          font-family: var(--font-mono);
        }
        .eyebrow {
          color: var(--primary);
          font: 800 0.68rem var(--font-mono);
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }
        .controls {
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem;
          padding: 1rem;
        }
        button {
          min-height: 2.6rem;
          padding: 0.65rem 0.9rem;
          border-radius: 0;
          cursor: pointer;
          font: 750 0.8rem var(--font-sans);
        }
        button:disabled {
          cursor: wait;
          opacity: 0.6;
        }
        .apply {
          border: 1px solid var(--primary);
          background: var(--primary);
          color: var(--primary-foreground);
        }
        .reset {
          border: 1px solid var(--clinical-rule-strong);
          background: transparent;
          color: var(--foreground);
        }
        .feedback {
          flex-basis: 100%;
          padding: 0.65rem;
          border-radius: 0;
          background: var(--muted);
          color: var(--muted-foreground);
          font-size: 0.75rem;
        }
        .feedback--success {
          background: var(--clinical-accent-soft);
          color: var(--clinical-accent-text);
        }
        .feedback--error {
          background: var(--accent);
          color: var(--destructive);
        }
        .program {
          overflow: hidden;
        }
        .program strong {
          display: block;
          padding: 0.7rem 0.85rem;
          color: var(--clinical-code);
          font: 700 0.66rem var(--font-mono);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        pre {
          min-height: 9rem;
          margin: 0;
          padding: 0.85rem;
          overflow: auto;
          background: #211f1e;
          color: #f3ede7;
          font: 0.7rem/1.55 var(--font-mono);
          white-space: pre;
        }
        pre :deep(.bxl-comment) {
          color: #6a9955;
          font-style: italic;
        }
        pre :deep(.bxl-string) {
          color: #ce9178;
        }
        pre :deep(.bxl-literal) {
          color: #569cd6;
        }
        pre :deep(.bxl-function) {
          color: #dcdcaa;
        }
        pre :deep(.bxl-number) {
          color: #b5cea8;
        }
        pre :deep(.bxl-operator) {
          color: #9cdcfe;
        }
        .result {
          position: sticky;
          top: 1rem;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 0.8rem;
          height: calc(100vh - 2rem);
          min-width: 0;
          padding: 1rem;
          overflow: hidden;
        }
        .result-heading {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: end;
          padding-bottom: 0.8rem;
          border-bottom: 1px solid var(--clinical-rule-strong);
        }
        .result h2 {
          margin-top: 0.2rem;
          font: 600 1.15rem/1.15 var(--font-serif);
        }
        .result-note {
          color: var(--muted-foreground);
          font: 0.64rem var(--font-mono);
        }
        .result-context {
          display: grid;
          justify-items: end;
          gap: 0.25rem;
        }
        .result-viewer {
          color: var(--primary);
          font: 700 0.64rem var(--font-mono);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .target-frame {
          min-height: 0;
          overflow: auto;
          border: 1px solid var(--clinical-rule-strong);
          border-radius: 0;
          background: var(--card);
        }
        @media (max-width: 76rem) {
          .workbench {
            grid-template-columns: 1fr;
          }
          .result {
            position: static;
            height: 45rem;
          }
        }
      </style>
      <style>
        .clinical-mutation-target-frame > .boxel-card-container {
          height: auto !important;
          min-height: 100%;
          max-height: none !important;
          overflow: visible !important;
        }
      </style>
    </template>
  };
}
