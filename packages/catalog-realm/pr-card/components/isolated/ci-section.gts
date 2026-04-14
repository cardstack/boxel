import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import type { CiStatus, CiGroup } from '../../utils';

// ── Sub-components ──────────────────────────────────────────────────────

interface CiDotSignature {
  Args: { state: CiStatus };
}

class CiDot extends GlimmerComponent<CiDotSignature> {
  get stateClass() {
    if (this.args.state === 'failure') return 'ci-dot--failure';
    if (this.args.state === 'in_progress') return 'ci-dot--pending';
    return 'ci-dot--success';
  }

  get ariaLabel() {
    if (this.args.state === 'failure') return 'failed';
    if (this.args.state === 'in_progress') return 'in progress';
    return 'passed';
  }

  get isPending() {
    return this.args.state === 'in_progress';
  }

  <template>
    <span class='ci-dot {{this.stateClass}}' aria-label={{this.ariaLabel}}>
      {{#if this.isPending}}
        <span class='ci-dot-inner'></span>
      {{/if}}
    </span>

    <style scoped>
      .ci-dot {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ci-dot--success {
        background: var(--chart-1, #28a745);
        position: relative;
      }
      .ci-dot--success::after {
        content: '';
        display: block;
        width: 5px;
        height: 3px;
        border-left: 1.5px solid #fff;
        border-bottom: 1.5px solid #fff;
        transform: rotate(-45deg) translateY(-1px);
      }
      .ci-dot--failure {
        background: var(--destructive, #d73a49);
        position: relative;
      }
      .ci-dot--failure::after {
        content: '';
        display: block;
        width: 5px;
        height: 6px;
        background:
          linear-gradient(
              45deg,
              transparent 30%,
              #fff 30%,
              #fff 70%,
              transparent 70%
            )
            no-repeat center / 100% 1.5px,
          linear-gradient(
              -45deg,
              transparent 30%,
              #fff 30%,
              #fff 70%,
              transparent 70%
            )
            no-repeat center / 100% 1.5px;
      }
      .ci-dot--pending {
        border: 2px solid var(--chart-4, #dbab09);
        background: transparent;
        animation: ci-spin 1s linear infinite;
      }
      .ci-dot-inner {
        display: block;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--chart-4, #dbab09);
      }
      @keyframes ci-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </template>
}

interface CiStatusLabelSignature {
  Args: { state: CiStatus; text: string };
}

class CiStatusLabel extends GlimmerComponent<CiStatusLabelSignature> {
  get stateClass() {
    if (this.args.state === 'failure') return 'ci-status-label--failure';
    if (this.args.state === 'in_progress') return 'ci-status-label--pending';
    return 'ci-status-label--success';
  }

  <template>
    <span class='ci-status-label {{this.stateClass}}'>{{@text}}</span>

    <style scoped>
      .ci-status-label {
        font-size: var(--boxel-font-2xs);
        font-weight: 400;
        line-height: 1.3;
        color: var(--card-foreground, #1f2328);
      }
      .ci-status-label--failure {
        color: var(--destructive, #d73a49);
      }
      .ci-status-label--pending {
        color: var(--chart-4, #dbab09);
      }
      .ci-status-label--success {
        color: var(--chart-1, #28a745);
      }
    </style>
  </template>
}

// ── Main Section ────────────────────────────────────────────────────────

interface CiSectionSignature {
  Args: {
    ciGroups: CiGroup[];
    isLoading?: boolean;
  };
}

export class CiSection extends GlimmerComponent<CiSectionSignature> {
  @cached get flatItems() {
    return this.args.ciGroups.flatMap((g) => g.items);
  }

  <template>
    <div class='ci-section'>
      <h2 class='section-heading'>CI Checks</h2>

      {{#if this.flatItems.length}}
        <ul class='ci-group' role='list'>
          {{#each this.flatItems key='name' as |item|}}
            <li class='ci-item'>
              <CiDot @state={{item.state}} />
              <div class='ci-item-detail'>
                <span class='ci-item-name'>{{item.name}}</span>
                <CiStatusLabel
                  @state={{item.state}}
                  @text={{item.statusText}}
                />
              </div>
            </li>
          {{/each}}
        </ul>
      {{else if @isLoading}}
        <div class='ci-item loading-state'>
          <CiDot @state='in_progress' />
          <div class='ci-item-detail'>
            <span class='ci-item-name loading-text'>Loading CI checks...</span>
          </div>
        </div>
      {{else}}
        <div class='empty-state'>
          <span class='empty-state-icon' aria-hidden='true'>
            <span class='empty-state-dot'></span>
          </span>
          <span class='empty-state-text'>No check events yet</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .ci-section {
        flex: 1;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        overflow-y: auto;
      }
      .section-heading {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--foreground, #1f2328);
        margin: 0;
      }
      .ci-group {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        border-radius: var(--radius, 6px);
        overflow: hidden;
      }
      .ci-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, var(--boxel-border-color));
      }
      .ci-group > * + * {
        border-top: none;
      }
      .ci-item-detail {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ci-item-name {
        font-size: var(--boxel-font-xl);
        font-weight: 500;
        color: var(--foreground, #1f2328);
        line-height: 1.2;
      }
      .empty-state {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, 6px);
      }
      .empty-state-icon {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: 2px solid var(--chart-4, #dbab09);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .empty-state-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--chart-4, #dbab09);
      }
      .empty-state-text {
        font-size: var(--boxel-font-xs);
        color: var(--muted-foreground, #656d76);
      }
      .loading-state {
        border-radius: var(--radius, 6px);
      }
      .loading-text {
        color: var(--muted-foreground, #656d76);
      }
    </style>
  </template>
}
