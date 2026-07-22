import { htmlSafe } from '@ember/template';

import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
} from './card-api';
import NumberField from './number';
import DateTimeField from './datetime';

import ProgressIcon from '@cardstack/boxel-icons/progress';

// A setup-progress job: a long-running task (indexing, import, a guided
// setup flow) whose progress the workspace surfaces on the Home tab's setup
// bar. The `Workspace` card discovers these by querying the realm for
// `ProcessCard` instances, so the field names here are a contract the
// Workspace reads (`listingName`, `progressDone`, `progressTotal`, `stage`,
// `startedAt`, `setupSurvey`, `processStatus`).
class ProcessTemplate extends Component<typeof ProcessCard> {
  <template>
    <article class='process-card'>
      <header class='process-card__header'>
        <span class='process-card__stage'>
          {{if @model.stage @model.stage 'In progress'}}
        </span>
        <h3 class='process-card__name'><@fields.cardTitle /></h3>
      </header>
      <div
        class='process-card__bar'
        role='progressbar'
        aria-valuenow={{@model.percentComplete}}
        aria-valuemin='0'
        aria-valuemax='100'
      >
        <div class='process-card__fill' style={{@model.barStyle}}></div>
      </div>
      <footer class='process-card__footer'>
        <span class='process-card__count'>{{@model.progressLabel}}</span>
        <span
          class='process-card__status'
          data-status={{@model.statusLabel}}
        >{{@model.statusLabel}}</span>
      </footer>
    </article>
    <style scoped>
      .process-card {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        container-type: inline-size;
      }
      .process-card__header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
        min-width: 0;
      }
      .process-card__stage {
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        text-transform: uppercase;
      }
      .process-card__name {
        margin: 0;
        font: 600 var(--boxel-font);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .process-card__bar {
        height: 6px;
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--boxel-200);
        overflow: hidden;
      }
      .process-card__fill {
        height: 100%;
        border-radius: inherit;
        background-color: var(--boxel-highlight);
        transition: width 0.3s ease;
      }
      .process-card__footer {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .process-card__status {
        text-transform: capitalize;
      }
    </style>
  </template>
}

export class ProcessCard extends CardDef {
  static displayName = 'Process Card';
  static icon = ProgressIcon;

  // The name shown on the setup bar; falls back to the card title.
  @field listingName = contains(StringField);
  // Human-readable label for the current step, e.g. "Importing files".
  @field stage = contains(StringField);
  // Progress as a fraction: `progressDone` of `progressTotal` items.
  @field progressDone = contains(NumberField);
  @field progressTotal = contains(NumberField);
  // When the process began; drives the Home tab's ETA estimate.
  @field startedAt = contains(DateTimeField);
  // Lifecycle status; the Workspace treats a missing value as 'running'.
  @field processStatus = contains(StringField);
  // Optional themed survey collected as part of setup (e.g. a questionnaire
  // whose answers gate later steps). Linked rather than contained so it can
  // be its own themed card.
  @field setupSurvey = linksTo(() => CardDef);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ProcessCard) {
      return this.listingName ?? 'Setup process';
    },
  });

  // Percentage complete, clamped to 0–100. Returns 0 when the total is
  // unknown so the bar renders empty rather than NaN-wide.
  get percentComplete(): number {
    let total = this.progressTotal ?? 0;
    if (total <= 0) {
      return 0;
    }
    let pct = Math.round(((this.progressDone ?? 0) / total) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  // "3 of 12 items", or '' when the total is unknown.
  get progressLabel(): string {
    let total = this.progressTotal;
    if (total == null) {
      return '';
    }
    return `${this.progressDone ?? 0} of ${total} items`;
  }

  get statusLabel(): string {
    return this.processStatus ?? 'running';
  }

  get barStyle() {
    return htmlSafe(`width: ${this.percentComplete}%`);
  }

  static isolated = ProcessTemplate;
  static embedded = ProcessTemplate;
  static fitted = ProcessTemplate;
}
