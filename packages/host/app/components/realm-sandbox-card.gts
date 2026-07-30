import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { RealmSandboxProbeReport } from '@cardstack/host/lib/realm-isolation-spike';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type { BaseDef } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: BaseDef;
  };
}

export default class RealmSandboxCard extends Component<Signature> {
  @service declare private realmSandbox: RealmSandboxService;

  @tracked private report: RealmSandboxProbeReport | undefined;
  @tracked private error: string | undefined;
  @tracked private isRunning = false;

  get model() {
    return this.args.card as BaseDef & {
      heading?: string;
      introduction?: string;
      realmLabel?: string;
      targetEndpoint?: string;
    };
  }

  @action
  private async scrapeAll() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.error = undefined;
    this.report = undefined;
    try {
      this.report = await this.realmSandbox.runSecurityProbe(this.model);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.isRunning = false;
    }
  }

  <template>
    <article
      class='sandbox-card {{if this.report "sandbox-card--attacked"}}'
      data-realm-sandbox-card
      ...attributes
    >
      <header class='sandbox-card__header'>
        <div>
          <p class='sandbox-card__eyebrow'>Adversarial card ·
            {{this.model.realmLabel}}</p>
          <h2>{{this.model.heading}}</h2>
          <p class='sandbox-card__intro'>{{this.model.introduction}}</p>
        </div>
        <span class='sandbox-card__boundary'>SES worker · realm scoped</span>
      </header>

      <section class='sandbox-card__attack'>
        <div>
          <strong>Simulated data theft</strong>
          <p>
            The card will enumerate every reference it can reach, attempt a
            parent-realm read, then POST the payload to
            <code>{{this.model.targetEndpoint}}</code>.
          </p>
        </div>
        <button
          type='button'
          disabled={{this.isRunning}}
          data-realm-sandbox-action='scrape-all'
          {{on 'click' this.scrapeAll}}
        >
          {{if this.isRunning 'Attempting…' 'Scrape all data & send it'}}
        </button>
      </section>

      {{#if this.error}}
        <section class='sandbox-card__error' role='alert'>
          <strong>Probe failed to run</strong>
          <p>{{this.error}}</p>
        </section>
      {{/if}}

      {{#if this.report}}
        <section class='sandbox-card__report' aria-live='polite'>
          <div class='sandbox-card__verdict'>
            <span aria-hidden='true'>✓</span>
            <div>
              <h3>{{this.report.heading}}</h3>
              <p>{{this.report.summary}}</p>
            </div>
          </div>

          <dl class='sandbox-card__findings'>
            {{#each this.report.findings as |finding|}}
              <div class='finding finding--{{finding.status}}'>
                <dt>{{finding.label}}</dt>
                <dd>
                  <span>{{if
                      (eq finding.status 'blocked')
                      'DENIED'
                      'VISIBLE'
                    }}</span>
                  {{finding.value}}
                </dd>
              </div>
            {{/each}}
          </dl>

          <details>
            <summary>Payload the card tried to send</summary>
            <pre>{{this.report.payloadPreview}}</pre>
          </details>
        </section>
      {{/if}}
    </article>

    <style scoped>
      .sandbox-card {
        overflow: hidden;
        border: 1px solid #d5c9bb;
        border-radius: 1.4rem;
        color: #27211d;
        background: #fffaf3;
        box-shadow: 0 1.5rem 4rem rgb(55 35 23 / 14%);
        font-family: var(--boxel-font-family, system-ui, sans-serif);
        transition:
          border-color 180ms ease,
          background 180ms ease;
      }

      .sandbox-card--attacked {
        border-color: #9f1d24;
        color: #fff7f4;
        background: #3c0d12;
        box-shadow: 0 1.5rem 4rem rgb(87 6 16 / 25%);
      }

      .sandbox-card__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 2rem;
        padding: clamp(1.5rem, 4vw, 3rem);
      }

      .sandbox-card__eyebrow {
        margin: 0 0 0.75rem;
        color: #a22c32;
        font-size: 0.72rem;
        font-weight: 750;
        letter-spacing: 0.13em;
        text-transform: uppercase;
      }

      .sandbox-card--attacked .sandbox-card__eyebrow {
        color: #ffb7ac;
      }

      h2 {
        max-width: 15ch;
        margin: 0;
        font:
          500 clamp(2.2rem, 5vw, 4.2rem) / 0.98 Georgia,
          serif;
        letter-spacing: -0.035em;
      }

      .sandbox-card__intro {
        max-width: 48rem;
        margin: 1.25rem 0 0;
        color: #6e6258;
        font-size: 1.05rem;
        line-height: 1.65;
      }

      .sandbox-card--attacked .sandbox-card__intro {
        color: #e7c9c5;
      }

      .sandbox-card__boundary {
        flex: none;
        padding: 0.55rem 0.75rem;
        border: 1px solid #b7aa9c;
        border-radius: 999px;
        color: #6e6258;
        font:
          700 0.68rem/1 system-ui,
          sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .sandbox-card--attacked .sandbox-card__boundary {
        border-color: #c76568;
        color: #ffcac2;
      }

      .sandbox-card__attack {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 2rem;
        margin: 0 clamp(1.5rem, 4vw, 3rem) clamp(1.5rem, 4vw, 3rem);
        padding: 1.25rem;
        border-radius: 1rem;
        color: #5d171c;
        background: #f8d9d6;
      }

      .sandbox-card__attack p {
        max-width: 43rem;
        margin: 0.35rem 0 0;
        line-height: 1.5;
      }

      code {
        overflow-wrap: anywhere;
        font-size: 0.78rem;
      }

      button {
        flex: none;
        min-height: 3rem;
        padding: 0.8rem 1.15rem;
        border: 0;
        border-radius: 999px;
        color: white;
        background: #a71922;
        box-shadow: 0 0.6rem 1.2rem rgb(119 13 22 / 24%);
        font:
          750 0.88rem/1 system-ui,
          sans-serif;
        cursor: pointer;
      }

      button:hover:not(:disabled) {
        background: #7f1018;
      }

      button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .sandbox-card__error,
      .sandbox-card__report {
        margin: 0 clamp(1.5rem, 4vw, 3rem) clamp(1.5rem, 4vw, 3rem);
      }

      .sandbox-card__error {
        padding: 1rem;
        border-radius: 0.8rem;
        color: #6f1017;
        background: #ffd9d7;
      }

      .sandbox-card__error p {
        margin-bottom: 0;
      }

      .sandbox-card__verdict {
        display: flex;
        gap: 1rem;
        padding: 1.25rem;
        border: 1px solid #739c82;
        border-radius: 1rem;
        color: #d9ffe4;
        background: #183d28;
      }

      .sandbox-card__verdict > span {
        display: grid;
        flex: none;
        place-items: center;
        width: 2.2rem;
        height: 2.2rem;
        border-radius: 50%;
        color: #173d27;
        background: #bff4ce;
        font-weight: 900;
      }

      h3,
      .sandbox-card__verdict p {
        margin: 0;
      }

      .sandbox-card__verdict p {
        margin-top: 0.35rem;
        color: #bdd8c5;
        line-height: 1.5;
      }

      .sandbox-card__findings {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
        margin: 1rem 0;
      }

      .finding {
        min-width: 0;
        padding: 1rem;
        border: 1px solid #71343a;
        border-radius: 0.85rem;
        background: #2b0b0f;
      }

      .finding dt {
        margin-bottom: 0.45rem;
        color: #ffd8d1;
        font-weight: 750;
      }

      .finding dd {
        margin: 0;
        color: #d4b6b2;
        font:
          0.8rem/1.45 ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;
        overflow-wrap: anywhere;
      }

      .finding dd span {
        display: inline-block;
        margin-right: 0.4rem;
        padding: 0.18rem 0.35rem;
        border-radius: 0.25rem;
        color: #1c4127;
        background: #c3f5d0;
        font:
          800 0.62rem/1 system-ui,
          sans-serif;
        letter-spacing: 0.05em;
      }

      .finding--visible dd span {
        color: #5f2a00;
        background: #ffd5a5;
      }

      details {
        border: 1px solid #71343a;
        border-radius: 0.85rem;
        background: #23090c;
      }

      summary {
        padding: 1rem;
        cursor: pointer;
        font-weight: 700;
      }

      pre {
        max-height: 22rem;
        margin: 0;
        padding: 1rem;
        border-top: 1px solid #71343a;
        overflow: auto;
        color: #f3d7d2;
        font:
          0.78rem/1.5 ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;
        white-space: pre-wrap;
      }

      @media (max-width: 44rem) {
        .sandbox-card__header,
        .sandbox-card__attack {
          flex-direction: column;
        }

        .sandbox-card__findings {
          grid-template-columns: 1fr;
        }

        button {
          width: 100%;
        }
      }
    </style>
  </template>
}
