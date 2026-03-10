import GlimmerComponent from '@glimmer/component';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import CopyIcon from '@cardstack/boxel-icons/copy';
import { Pill } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import type { CardOrFieldTypeIcon } from 'https://cardstack.com/base/card-api';

interface HeaderSectionSignature {
  Args: {
    title: string;
    prNumber: number | null | undefined;
    branchName: string | null | undefined;
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
  copyBranchName = async () => {
    let branchName = this.args.branchName?.trim();
    if (!branchName) {
      return;
    }
    await navigator.clipboard.writeText(branchName);
  };

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

        {{#if @branchName}}
          <span class='pr-branch'>
            <span class='pr-branch-label'>{{@branchName}}</span>
            <button
              type='button'
              class='pr-branch-copy-button'
              {{on 'click' this.copyBranchName}}
              aria-label='Copy branch name'
              title='Copy branch name'
            >
              <CopyIcon class='pr-branch-copy-icon' />
            </button>
          </span>
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
      .pr-branch {
        font-size: var(--boxel-font-xs);
        color: var(--pr-branch-foreground, #9ecbff);
        border: 1px solid var(--pr-branch-border, #3d444d);
        border-radius: 999px;
        padding: 1px 4px 1px 8px;
        max-width: 280px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .pr-branch-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pr-branch-copy-button {
        border: none;
        background: transparent;
        color: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px;
        border-radius: 999px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .pr-branch-copy-button:hover {
        background: color-mix(
          in srgb,
          var(--pr-branch-foreground, #9ecbff) 20%,
          transparent
        );
      }
      .pr-branch-copy-icon {
        width: 11px;
        height: 11px;
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
