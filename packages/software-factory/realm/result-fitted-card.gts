import GlimmerComponent from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import { FittedCard } from '@cardstack/boxel-ui/components';
import { StatusPill } from './status-pill.gts';
import Clock from '@cardstack/boxel-icons/clock';

type IconComponent = ComponentLike<{ Element: SVGSVGElement }>;

export type ResultMetaTone = 'clean' | 'error' | 'warning' | 'muted';

export interface ResultMetaItem {
  icon: IconComponent;
  text: string;
  tone?: ResultMetaTone;
}

interface Signature {
  Args: {
    // Eyebrow icon and label, rendered as "<label> #<sequenceNumber>".
    icon: IconComponent;
    label: string;
    sequenceNumber?: number;
    // Already-resolved display status, including the synthetic 'empty' value.
    status?: string;
    // Label shown for the 'empty' status (e.g. "No Files").
    emptyLabel?: string;
    title: string;
    durationMs?: number;
    metaItems?: ResultMetaItem[];
  };
  Blocks: {
    subtitle: [];
  };
}

export class ResultFittedCard extends GlimmerComponent<Signature> {
  get statusLabel() {
    switch (this.args.status) {
      case 'passed':
        return 'Passed';
      case 'failed':
        return 'Failed';
      case 'error':
        return 'Error';
      case 'running':
        return 'Running';
      case 'empty':
        return this.args.emptyLabel ?? 'Empty';
      default:
        return 'Unknown';
    }
  }

  get statusColor() {
    switch (this.args.status) {
      case 'passed':
        return 'oklch(60% 0.17 150)';
      case 'failed':
        return 'oklch(55% 0.22 25)';
      case 'error':
        return 'oklch(68% 0.17 55)';
      case 'running':
        return 'oklch(60% 0.16 250)';
      default:
        return 'var(--muted-foreground, var(--boxel-500))';
    }
  }

  <template>
    <FittedCard class='result-fitted' @titleTag='h3'>
      <:eyebrow>
        <div class='result-id'>
          <@icon width='14' height='14' aria-hidden='true' />
          <span>{{@label}} #{{@sequenceNumber}}</span>
        </div>
      </:eyebrow>
      <:badgeRight>
        <StatusPill class='status-badge-right' @color={{this.statusColor}}>
          {{this.statusLabel}}
        </StatusPill>
      </:badgeRight>
      <:title>{{@title}}</:title>
      <:subtitle>{{yield to='subtitle'}}</:subtitle>
      <:meta>
        <div class='result-meta'>
          {{#each @metaItems as |item|}}
            <span class='meta-item meta-{{if item.tone item.tone "muted"}}'>
              <item.icon
                class='meta-icon'
                width='13'
                height='13'
                aria-hidden='true'
              />{{item.text}}
            </span>
          {{/each}}
        </div>
      </:meta>
      <:footer>
        <StatusPill class='status-pill' @color={{this.statusColor}}>
          {{this.statusLabel}}
        </StatusPill>
        {{#if @durationMs}}
          <span class='footer-duration'>
            <Clock
              class='meta-icon'
              width='12'
              height='12'
              aria-hidden='true'
            />{{@durationMs}}ms
          </span>
        {{/if}}
      </:footer>
    </FittedCard>
    <style scoped>
      .result-fitted {
        --boxel-heading-font-weight: 500;
        --fc-title-line-clamp: 2;
        --fc-subtitle-line-clamp: 1;
        --fc-badge-right-display: none;
        --fc-meta-display: none;
      }
      .result-id {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-500));
        flex-shrink: 0;
      }
      .status-badge-right {
        font-size: 0.6875rem;
      }
      .status-pill {
        margin-right: auto;
      }
      .footer-duration {
        display: inline-flex;
        align-items: center;
        gap: 0.25em;
        font-size: 0.625rem;
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
        flex-shrink: 0;
      }
      .result-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        width: 100%;
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid
          color-mix(
            in oklch,
            var(--border, var(--boxel-border-color)) 50%,
            transparent
          );
      }
      .meta-item {
        display: inline-flex;
        align-items: center;
        gap: 0.3em;
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .meta-icon {
        flex-shrink: 0;
      }
      .meta-clean {
        color: oklch(60% 0.17 150);
      }
      .meta-error {
        color: oklch(55% 0.22 25);
      }
      .meta-warning {
        color: oklch(68% 0.17 55);
      }
      .meta-muted {
        color: var(--muted-foreground, var(--boxel-500));
      }
      /* Shrink the title in very short strips */
      @container fitted-card (height < 65px) {
        .result-fitted {
          --fc-title-font-size: var(--boxel-font-size-xs);
        }
      }
      /* Show the status badge in the top-right on wide, short badge layouts */
      @container fitted-card (1.0 < aspect-ratio) and (width >= 150px) and (height <= 105px) {
        .result-fitted {
          --fc-badge-right-display: block;
          --fc-badge-offset: -1px;
        }
        .status-badge-right {
          border-bottom-right-radius: 0;
          border-top-right-radius: 0;
          border-top-left-radius: 0;
        }
      }
      /* Drop the footer on tall narrow badges where there's no room */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height >= 105px) {
        .result-fitted {
          --fc-footer-display: none;
        }
      }
      /* Reveal the counts row once the card is tall enough */
      @container fitted-card ((width >= 150px) and (height >= 170px)) {
        .result-fitted {
          --fc-meta-display: block;
          --fc-title-line-clamp: 3;
        }
      }
    </style>
  </template>
}
