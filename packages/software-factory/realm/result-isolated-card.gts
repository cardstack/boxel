import GlimmerComponent from '@glimmer/component';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { StatusPill } from './status-pill.gts';
import { resultStatusColor, resultStatusLabel } from './result-fitted-card.gts';
import CalendarTime from '@cardstack/boxel-icons/calendar-time';
import Clock from '@cardstack/boxel-icons/clock';

interface Signature {
  Args: {
    title: string;
    // Already-resolved display status, including the synthetic 'empty' value.
    status?: string;
    // Label shown for the 'empty' status (e.g. "No Files").
    emptyLabel?: string;
    durationMs?: number;
    // When the run started / finished; the later of the two is surfaced.
    runAt?: Date;
    completedAt?: Date;
    // Gate the optional sections; the matching block supplies the content.
    hasProject?: unknown;
    hasIssue?: unknown;
    hasError?: unknown;
    // Heading for the details section; the section shows only when hasDetails.
    detailsTitle?: string;
    hasDetails?: unknown;
  };
  Blocks: {
    summary: [];
    project: [];
    issue: [];
    error: [];
    details: [];
  };
  Element: HTMLElement;
}

export class ResultIsolatedCard extends GlimmerComponent<Signature> {
  get statusLabel() {
    return resultStatusLabel(this.args.status, this.args.emptyLabel);
  }

  get statusColor() {
    return resultStatusColor(this.args.status);
  }

  // Prefer the completion time; fall back to the start time for runs still
  // in flight (or older results that only recorded when they began).
  get timestamp() {
    return this.args.completedAt ?? this.args.runAt;
  }

  <template>
    <article class='result-surface' ...attributes>
      <header class='result-header'>
        <div class='header-row'>
          <h1 class='result-title'>{{@title}}</h1>
          <StatusPill class='status-pill' @color={{this.statusColor}}>
            {{this.statusLabel}}
          </StatusPill>
        </div>
        <div class='result-summary'>
          {{yield to='summary'}}
          {{#if @durationMs}}
            <span class='result-duration'>
              <Clock
                width='13'
                height='13'
                aria-hidden='true'
              />{{@durationMs}}ms
            </span>
          {{/if}}
          {{#if this.timestamp}}
            <span class='result-timestamp'>
              <CalendarTime width='13' height='13' aria-hidden='true' />
              {{formatDateTime
                this.timestamp
                dateStyle='medium'
                timeStyle='short'
              }}
            </span>
          {{/if}}
        </div>
      </header>

      {{#if @hasProject}}
        <section class='result-section'>
          <h2>Project</h2>
          <div class='linked-card'>{{yield to='project'}}</div>
        </section>
      {{/if}}

      {{#if @hasIssue}}
        <section class='result-section'>
          <h2>Issue</h2>
          <div class='linked-card'>{{yield to='issue'}}</div>
        </section>
      {{/if}}

      {{#if @hasError}}
        <section class='result-section'>
          <h2>Error</h2>
          <pre class='result-error'>{{yield to='error'}}</pre>
        </section>
      {{/if}}

      {{#if @hasDetails}}
        <section class='result-section'>
          {{#if @detailsTitle}}<h2>{{@detailsTitle}}</h2>{{/if}}
          {{yield to='details'}}
        </section>
      {{/if}}
    </article>
    <style scoped>
      .result-surface {
        height: 100%;
        overflow-y: auto;
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp);
        align-content: start;
      }
      .result-header {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .result-title {
        margin: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .status-pill {
        flex-shrink: 0;
      }
      .result-summary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-500));
      }
      .result-duration,
      .result-timestamp {
        display: inline-flex;
        align-items: center;
        gap: 0.3em;
        flex-shrink: 0;
      }
      .result-section {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .result-section > h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .linked-card {
        display: grid;
      }
      .result-error {
        margin: 0;
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background: color-mix(in oklch, oklch(55% 0.22 25) 8%, transparent);
        color: oklch(55% 0.22 25);
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-sm);
        white-space: pre-wrap;
        word-break: break-word;
        overflow-x: auto;
      }
    </style>
  </template>
}
