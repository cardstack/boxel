import { Component } from 'https://cardstack.com/base/card-api';
import type { Survey } from '../../survey';

export class SurveyFitted extends Component<typeof Survey> {
  get title(): string {
    return this.args.model?.title ?? 'Untitled survey';
  }
  get count(): number {
    return this.args.model?.questions?.length ?? 0;
  }
  get countLabel(): string {
    return `${this.count} ${this.count === 1 ? 'question' : 'questions'}`;
  }

  <template>
    <div class='sf-root'>
      {{! BADGE  ≤150 × ≤169 }}
      <div class='sf-badge'>
        <div class='sf-icon'>?</div>
        <div class='sf-b-body'>
          <div class='sf-b-title'>{{this.title}}</div>
          <div class='sf-b-sub'>{{this.countLabel}}</div>
        </div>
      </div>

      {{! STRIP  ≥151px wide, ≤169px tall }}
      <div class='sf-strip'>
        <div class='sf-icon'>?</div>
        <div class='sf-s-body'>
          <div class='sf-s-title'>{{this.title}}</div>
          <div class='sf-s-sub'>Survey · {{this.countLabel}}</div>
        </div>
      </div>

      {{! TILE  ≤399px wide, ≥170px tall }}
      <div class='sf-tile'>
        <div class='sf-t-head'>
          <span class='sf-icon sf-icon--lg'>?</span>
          <span class='sf-t-eyebrow'>Survey</span>
        </div>
        <div class='sf-t-title'>{{this.title}}</div>
        <div class='sf-t-count'>{{this.countLabel}}</div>
      </div>

      {{! CARD  ≥400px wide, ≥170px tall }}
      <div class='sf-card'>
        <div class='sf-c-left'>
          <span class='sf-icon sf-icon--lg'>?</span>
        </div>
        <div class='sf-c-body'>
          <span class='sf-c-eyebrow'>Survey</span>
          <span class='sf-c-title'>{{this.title}}</span>
          <span class='sf-c-count'>{{this.countLabel}}</span>
        </div>
      </div>
    </div>

    <style scoped>
      .sf-root {
        --sf-accent: var(--primary, var(--boxel-highlight));
        container-type: size;
        width: 100%;
        height: 100%;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        color: var(--foreground, var(--boxel-dark));
      }
      .sf-badge,
      .sf-strip,
      .sf-tile,
      .sf-card {
        display: none;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
        background: var(--card, var(--boxel-light));
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: 0.75rem;
      }

      .sf-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.5rem;
        background: color-mix(in srgb, var(--sf-accent) 14%, transparent);
        color: var(--sf-accent);
        font-weight: 800;
        font-size: 1.1rem;
      }
      .sf-icon--lg {
        width: 2.75rem;
        height: 2.75rem;
        font-size: 1.5rem;
        border-radius: 0.625rem;
      }

      /* BADGE */
      @container (max-width: 150px) and (max-height: 169px) {
        .sf-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
        }
      }
      .sf-b-body {
        min-width: 0;
      }
      .sf-b-title {
        font-size: 0.8125rem;
        font-weight: 700;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .sf-b-sub {
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }

      /* STRIP */
      @container (min-width: 151px) and (max-height: 169px) {
        .sf-strip {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
        }
      }
      .sf-s-body {
        min-width: 0;
      }
      .sf-s-title {
        font-size: 0.9375rem;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sf-s-sub {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }

      /* TILE */
      @container (max-width: 399px) and (min-height: 170px) {
        .sf-tile {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding: 0.875rem;
        }
      }
      .sf-t-head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .sf-t-eyebrow {
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--sf-accent);
      }
      .sf-t-title {
        font-size: 1.0625rem;
        font-weight: 800;
        line-height: 1.2;
        margin-top: auto;
      }
      .sf-t-count {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }

      /* CARD */
      @container (min-width: 400px) and (min-height: 170px) {
        .sf-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.25rem;
        }
      }
      .sf-c-body {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
      }
      .sf-c-eyebrow {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--sf-accent);
      }
      .sf-c-title {
        font-size: 1.375rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        line-height: 1.15;
      }
      .sf-c-count {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}
