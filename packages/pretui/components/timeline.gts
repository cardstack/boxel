// Pretui — Timeline: an ordered list of events with a decorative rail.
import Component from '@glimmer/component';
import { Avatar } from './avatar';
import { StatusChip } from './status-chip';
import { Token } from './token';
import { RelativeTime } from './relative-time';
import { iconFor } from '../icon-registry';

// ── Timeline ─────────────────────────────────────────────────────────────
// A chronological sequence, semantically an ordered list.
//
// The rail and the markers are pure chrome: the rail is a CSS pseudo-element
// (invisible to assistive tech by construction) and the marker span carries
// aria-hidden, so a screen reader reads "1. Lot B-1181 cupped — 3 days ago"
// and not a stream of bullet noise. Everything with meaning is composed from
// the kit: StatusChip (hue derived from the value, Law 2), Token (machine
// values as jewelry, Law 3), RelativeTime (timer-free, @now supplied by the
// caller), Avatar.
//
// Dropped from the upstream surfaces: left/right alternating layout (MUI's
// signature look — it doubles the CSS, halves the line length, and reads as
// two unrelated columns at narrow widths), the "opposite content" slot that
// exists only to feed that layout, and per-event duration bars (that is
// <Meter> or <ProgressBar> composed into the <:default> block).

export interface TimelineEvent {
  /** stable id — the {{#each}} key */
  id: string;
  /** the headline for this moment */
  title: string;
  /** ISO date/time → RelativeTime, rendered against @now */
  at?: string;
  /** status value → StatusChip */
  status?: string;
  /** machine value (lot id, version, batch) → Token */
  token?: string;
  /** person's name → Avatar + name */
  person?: string;
  /** one paragraph of detail; the <:default> block replaces it */
  body?: string;
  /** icon-registry name for the marker; omitted markers are a dot */
  icon?: string;
}

export interface TimelineSignature {
  Args: {
    /** the events, oldest or newest first — the order you pass is the order
     * rendered and numbered */
    events: TimelineEvent[];
    /** 'expanded' (default) gives each event a body block and a large marker;
     * 'compact' collapses to one line per event */
    density?: 'compact' | 'expanded';
    /** the instant relative times are measured against; the realm forbids
     * timers, so nothing ticks — pass a fresh @now to re-derive */
    now?: string | Date;
    /** accessible name for the list */
    label?: string;
  };
  Blocks: {
    /** replaces @body — receives the event */
    default?: [event: TimelineEvent];
    /** replaces the marker glyph — receives the event */
    marker?: [event: TimelineEvent];
  };
  Element: HTMLElement;
}

export class Timeline extends Component<TimelineSignature> {
  get density(): 'compact' | 'expanded' {
    return this.args.density ?? 'expanded';
  }
  get label(): string {
    return this.args.label ?? 'Timeline';
  }
  iconOf = (event: TimelineEvent) => iconFor(event.icon);

  <template>
    {{! role='list' is not redundant: list-style:none strips list semantics
        in Safari/VoiceOver, and the lint rule allows ol+list }}
    <ol
      class='pretui-timeline'
      role='list'
      data-density={{this.density}}
      aria-label={{this.label}}
      data-test-pretui-timeline
      ...attributes
    >
      {{#each @events key='id' as |event|}}
        <li class='pretui-timeline-event'>
          <span class='pretui-timeline-marker' aria-hidden='true'>
            {{#if (has-block 'marker')}}
              {{yield event to='marker'}}
            {{else}}
              {{#let (this.iconOf event) as |EventIcon|}}
                {{#if EventIcon}}
                  <EventIcon class='pretui-timeline-glyph' />
                {{else}}
                  <span class='pretui-timeline-dot'></span>
                {{/if}}
              {{/let}}
            {{/if}}
          </span>
          <div class='pretui-timeline-body'>
            <div class='pretui-timeline-head'>
              <span class='pretui-timeline-title'>{{event.title}}</span>
              {{#if event.token}}<Token @value={{event.token}} />{{/if}}
              {{#if event.status}}<StatusChip @value={{event.status}} />{{/if}}
              {{#if event.at}}
                <RelativeTime
                  class='pretui-timeline-when'
                  @date={{event.at}}
                  @now={{@now}}
                />
              {{/if}}
            </div>
            {{#if (has-block)}}
              <div class='pretui-timeline-detail'>{{yield event}}</div>
            {{else if event.body}}
              <p class='pretui-timeline-detail'>{{event.body}}</p>
            {{/if}}
            {{#if event.person}}
              <span class='pretui-timeline-person'>
                <Avatar @name={{event.person}} @size={{18}} />
                {{event.person}}
              </span>
            {{/if}}
          </div>
        </li>
      {{/each}}
    </ol>
    <style scoped>
      /* above RelativeTime's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-timeline {
          /* one gap and one rail width, resolved once on the root so the
             pseudo-element rail can never drift from the row spacing */
          --_gap: var(--pretui-timeline-gap, 14px);
          --_rail: var(--pretui-timeline-rail, 24px);
          container-type: inline-size;
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--_gap);
          min-width: 0;
        }
        .pretui-timeline[data-density='compact'] {
          --_gap: var(--pretui-timeline-gap, 4px);
          --_rail: var(--pretui-timeline-rail, 16px);
        }
        .pretui-timeline-event {
          position: relative;
          display: grid;
          grid-template-columns: var(--_rail) 1fr;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        /* the rail: chrome only, drawn by a pseudo-element so assistive tech
           never sees it (Law 1 — a hairline, never a contrast block) */
        .pretui-timeline-event::before {
          content: '';
          position: absolute;
          left: calc(var(--_rail) / 2);
          top: 0;
          bottom: calc(var(--_gap) * -1);
          width: 1px;
          background: var(--border);
        }
        .pretui-timeline-event:last-child::before {
          display: none;
        }
        .pretui-timeline-marker {
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: var(--_rail);
          height: var(--_rail);
          border-radius: 50%;
          background: var(--card);
          color: var(--muted-foreground);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-timeline-glyph {
          width: 13px;
          height: 13px;
        }
        .pretui-timeline-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--pretui-primary-ink, var(--primary));
        }
        .pretui-timeline-body {
          display: grid;
          gap: 4px;
          min-width: 0;
          padding-bottom: 2px;
        }
        .pretui-timeline-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
        }
        .pretui-timeline-title {
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 600;
          color: var(--foreground);
          min-width: 0;
        }
        .pretui-timeline-when {
          margin-left: auto;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-timeline-detail {
          margin: 0;
          font-size: var(--text-ui-md, 12.5px);
          color: var(--muted-foreground);
          line-height: 1.5;
          max-width: 62ch;
        }
        .pretui-timeline-person {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        /* compact: one line per event, small marker, no marker chrome */
        .pretui-timeline[data-density='compact'] .pretui-timeline-event {
          align-items: center;
        }
        .pretui-timeline[data-density='compact'] .pretui-timeline-marker {
          /* no hairline ring at this size — the dot alone punches the rail */
          box-shadow: none;
        }
        .pretui-timeline[data-density='compact'] .pretui-timeline-glyph {
          width: 11px;
          height: 11px;
        }
        .pretui-timeline[data-density='compact'] .pretui-timeline-body {
          gap: 2px;
          padding: 3px 0;
        }
        .pretui-timeline[data-density='compact'] .pretui-timeline-detail {
          font-size: var(--text-ui-sm, 11.5px);
        }
        /* unnamed container query — resolves against the .pretui-timeline
           ancestor container, so it may only style descendants */
        @container (max-width: 26rem) {
          .pretui-timeline-when {
            margin-left: 0;
          }
          .pretui-timeline-detail {
            max-width: none;
          }
        }
      }
    </style>
  </template>
}
