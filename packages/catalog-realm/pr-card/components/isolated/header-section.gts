import GlimmerComponent from '@glimmer/component';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import { Pill } from '@cardstack/boxel-ui/components';
import type { CardOrFieldTypeIcon } from 'https://cardstack.com/base/card-api';

interface HeaderSectionSignature {
  Args: {
    title: string;
    prNumber: number | null | undefined;
    prUrl: string | null;
    actionLabel: string;
    actionIcon: CardOrFieldTypeIcon;
    pillColor: string;
    submittedBy: string | null | undefined;
  };
  Blocks: {
    date: [];
  };
}

export class HeaderSection extends GlimmerComponent<HeaderSectionSignature> {
  <template>
    <header class='pr-hero'>
      <h1 class='pr-title'>
        {{@title}}
        {{#if @prNumber}}
          <span class='pr-number'>#{{@prNumber}}</span>
        {{/if}}
      </h1>
      <div class='pr-meta'>
        <Pill class='pr-state-pill' @pillBackgroundColor={{@pillColor}}>
          <:iconLeft>
            <@actionIcon class='pr-state-icon' />
          </:iconLeft>
          <:default>
            <span class='pr-state-label'>{{@actionLabel}}</span>
          </:default>
        </Pill>

        {{#if @submittedBy}}
          <strong class='pr-author'>{{@submittedBy}}</strong>
        {{/if}}

        {{#if (has-block 'date')}}
          <span class='pr-meta-sep'>·</span>
          <span class='pr-date'>{{yield to='date'}}</span>
        {{/if}}

        <a
          href={{@prUrl}}
          target='_blank'
          rel='noopener noreferrer'
          class='pr-github-link'
          title='Open PR on GitHub'
          aria-label='Open PR on GitHub'
        >
          <ExternalLinkIcon class='pr-github-link-icon' />
        </a>
      </div>
    </header>

    <style scoped>
      .pr-hero {
        background: #0d1117;
        color: #e6edf3;
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        flex-shrink: 0;
        border-bottom: 1px solid #30363d;
      }
      .pr-title {
        font-size: 1.4rem;
        font-weight: 600;
        margin: 0;
        line-height: 1.3;
        color: #e6edf3;
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .pr-number {
        font-size: 1.2rem;
        font-weight: 600;
        color: #8b949e;
      }
      .pr-meta {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .pr-state-pill {
        --boxel-pill-border-radius: 2em;
      }
      .pr-state-icon {
        width: 14px;
        height: 14px;
        color: #fff;
        flex-shrink: 0;
      }
      .pr-state-label {
        font-size: var(--boxel-font-xs);
        font-weight: 600;
        color: #fff;
      }
      .pr-author {
        font-size: var(--boxel-font-xs);
        color: #e6edf3;
        font-weight: 600;
      }
      .pr-date {
        font-size: var(--boxel-font-xs);
        color: #8b949e;
      }
      .pr-meta-sep {
        color: #484f58;
        font-size: var(--boxel-font-xs);
      }
      .pr-github-link {
        margin-left: auto;
        color: #8b949e;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: color 0.15s ease;
      }
      .pr-github-link:hover {
        color: #58a6ff;
      }
      .pr-github-link-icon {
        width: 14px;
        height: 14px;
      }
    </style>
  </template>
}
