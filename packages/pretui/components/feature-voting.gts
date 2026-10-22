// Pretui — FeatureVoting: a ranked list of feature requests people can vote on.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Chip } from './chip';
import { EmptyState } from './empty-state';
import { cssStyleFrom } from '../pretui-css';

// ── FeatureVoting ────────────────────────────────────────────────────────
// A tally block: what should be built next, and how many people said so.
//
// The vote control is a toggle, not a fire-and-forget button, so it carries
// `aria-pressed` and its accessible name states both the subject and the
// count ("Upvote Bulk export, 42 votes"). Upstream renders the same control
// as a coloured div: a screen-reader user cannot tell they have voted, and a
// greyscale reader cannot either. Here the pressed state has a filled
// chevron, a weight change, and a ring — colour is the fourth signal, not
// the only one.
//
// The share bar is proportional to the leading option, not to the total, so
// a shelf with one runaway favourite still shows shape. It is decorative and
// `aria-hidden`; the number beside it is the datum.

export interface FeatureVote {
  /** stable id — the {{#each}} key */
  id: string;
  /** what is being voted on */
  title: string;
  /** one line of detail */
  description?: string;
  /** current tally */
  votes: number;
  /** whether the reader has already voted for this */
  voted?: boolean;
  /** free label, rendered as a chip */
  tag?: string;
}

export interface FeatureVotingSignature {
  Args: {
    /** the ballot */
    features: FeatureVote[];
    /** heading (default 'What should we build next?') */
    title?: string;
    /** one line under the heading */
    description?: string;
    /**
     * fires with the feature and the state the reader is asking for. The
     * component never mutates the tally itself — the caller owns the number,
     * because the number lives on a server.
     */
    onVote?: (feature: FeatureVote, voted: boolean) => void;
    /**
     * 'votes' (default) sorts the ballot by tally, highest first, with the
     * title as a stable tiebreak; 'given' keeps the caller's order.
     */
    sort?: 'votes' | 'given';
    /** what an empty ballot says */
    emptyMessage?: string;
  };
  Element: HTMLElement;
}

interface VoteRow extends FeatureVote {
  votedNow: boolean;
  share: ReturnType<typeof cssStyleFrom>;
  countLabel: string;
  buttonLabel: string;
}

export class FeatureVoting extends Component<FeatureVotingSignature> {
  get features(): FeatureVote[] {
    return this.args.features ?? [];
  }
  get title(): string {
    return this.args.title ?? 'What should we build next?';
  }
  get total(): number {
    return this.features.reduce((sum, f) => sum + (f.votes ?? 0), 0);
  }
  get leader(): number {
    return this.features.reduce((max, f) => Math.max(max, f.votes ?? 0), 0);
  }
  get rows(): VoteRow[] {
    let list = [...this.features];
    if ((this.args.sort ?? 'votes') === 'votes') {
      // deterministic: tally descending, then title — never Math.random,
      // never insertion-order-dependent
      list.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.title.localeCompare(b.title));
    }
    let leader = this.leader || 1;
    return list.map((feature) => {
      let votes = feature.votes ?? 0;
      let votedNow = feature.voted ?? false;
      let percent = Math.round((votes / leader) * 100);
      return {
        ...feature,
        votedNow,
        share: cssStyleFrom(['--pretui-vote-share: ' + percent + '%']),
        countLabel: votes === 1 ? '1 vote' : votes + ' votes',
        buttonLabel:
          (votedNow ? 'Remove your vote for ' : 'Upvote ') +
          feature.title +
          ', ' +
          (votes === 1 ? '1 vote' : votes + ' votes'),
      };
    });
  }
  get tally(): string {
    let n = this.total;
    return n === 1 ? '1 vote cast' : n + ' votes cast';
  }

  vote = (feature: VoteRow) => this.args.onVote?.(feature, !feature.votedNow);

  <template>
    <section
      class='pretui-vote'
      aria-label={{this.title}}
      data-test-pretui-feature-voting
      ...attributes
    >
      <header class='pretui-vote-head'>
        <h3 class='pretui-vote-title'>{{this.title}}</h3>
        <span class='pretui-vote-tally'>{{this.tally}}</span>
      </header>
      {{#if @description}}
        <p class='pretui-vote-desc'>{{@description}}</p>
      {{/if}}

      {{#if this.rows.length}}
        <ul class='pretui-vote-list'>
          {{#each this.rows key='id' as |row|}}
            <li class='pretui-vote-row' data-voted={{if row.votedNow 'true'}}>
              <button
                type='button'
                class='pretui-vote-btn'
                aria-pressed={{if row.votedNow 'true' 'false'}}
                aria-label={{row.buttonLabel}}
                data-test-pretui-feature-voting-button
                {{on 'click' (fn this.vote row)}}
              >
                <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                  <path
                    d='M12 5l7 8H5z'
                    fill={{if row.votedNow 'currentColor' 'none'}}
                    stroke='currentColor'
                    stroke-width='2'
                    stroke-linejoin='round'
                  />
                </svg>
                <span class='pretui-vote-num' aria-hidden='true'
                >{{row.votes}}</span>
              </button>
              <span class='pretui-vote-body'>
                <span class='pretui-vote-name'>
                  {{row.title}}
                  {{#if row.tag}}<Chip @label={{row.tag}} @dot={{false}} />{{/if}}
                </span>
                {{#if row.description}}
                  <span class='pretui-vote-detail'>{{row.description}}</span>
                {{/if}}
                <span class='pretui-vote-bar' style={{row.share}} aria-hidden='true'
                ><i></i></span>
              </span>
              <span class='pretui-vote-count'>{{row.countLabel}}</span>
            </li>
          {{/each}}
        </ul>
      {{else}}
        <EmptyState
          @title='Nothing on the ballot'
          @message={{if
            @emptyMessage
            @emptyMessage
            'Suggestions appear here once someone files one.'
          }}
        />
      {{/if}}
    </section>

    <style scoped>
      @layer PretComponent {
        .pretui-vote {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 9px);
          padding: var(--space-4, 13px);
          border-radius: var(--radius-surface, 14px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.08)
          );
          font-size: var(--text-ui-md, 12.5px);
          container-type: inline-size;
        }
        .pretui-vote-head {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .pretui-vote-title {
          margin: 0;
          flex: 1;
          min-width: 0;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .pretui-vote-tally {
          flex: none;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--ink-3, var(--boxel-400));
          font-variant-numeric: tabular-nums;
        }
        .pretui-vote-desc {
          margin: 0;
          max-width: 62ch;
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 1.6;
          color: var(--muted-foreground);
        }
        .pretui-vote-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-vote-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 8px;
          border-radius: 10px;
        }
        .pretui-vote-row:hover {
          background: var(--inset, var(--boxel-100));
        }
        .pretui-vote-btn {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          width: 40px;
          min-height: 44px;
          flex: none;
          padding: 4px 0;
          border: 0;
          border-radius: 9px;
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
          font: inherit;
          color: var(--muted-foreground);
          cursor: pointer;
          transition: box-shadow 140ms linear;
        }
        .pretui-vote-btn svg {
          width: 14px;
          height: 14px;
        }
        .pretui-vote-num {
          font-size: 11px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .pretui-vote-btn:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-vote-btn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* pressed: filled glyph + weight + ring, and only then colour */
        .pretui-vote-btn[aria-pressed='true'] {
          color: color-mix(
            in oklch,
            var(--foreground) 16%,
            var(--primary)
          );
          font-weight: 700;
          background: color-mix(
            in oklch,
            var(--primary) 10%,
            var(--card)
          );
          box-shadow:
            0 0 0 1px
              color-mix(in oklch, var(--primary) 55%, var(--border)),
            inset 0 0 0 1px
              color-mix(in oklch, var(--primary) 18%, transparent);
        }
        .pretui-vote-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .pretui-vote-name {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 500;
          min-width: 0;
        }
        .pretui-vote-detail {
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 1.5;
          color: var(--muted-foreground);
        }
        .pretui-vote-bar {
          display: block;
          height: 3px;
          margin-top: 3px;
          border-radius: 2px;
          background: var(--inset, var(--boxel-100));
          overflow: hidden;
        }
        .pretui-vote-bar i {
          display: block;
          height: 100%;
          width: var(--pretui-vote-share, 0%);
          border-radius: 2px;
          background: color-mix(
            in oklch,
            var(--primary) 55%,
            var(--border)
          );
          transition: width 320ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-vote-row[data-voted] .pretui-vote-bar i {
          background: var(--primary);
        }
        .pretui-vote-count {
          flex: none;
          align-self: center;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--ink-3, var(--boxel-400));
          font-variant-numeric: tabular-nums;
        }
        /* unnamed container query — resolves against .pretui-vote */
        @container (max-width: 24rem) {
          .pretui-vote-count {
            display: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-vote-bar i,
          .pretui-vote-btn {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
