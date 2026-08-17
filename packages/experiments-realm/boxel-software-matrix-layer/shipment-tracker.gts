import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import {
  SHIPMENT_PIPELINE,
  shipmentStatusStyle,
  shipmentStageIndex,
  isShipmentException,
} from './shipment-status';

// Shipment Tracker (ST), Tracking Status View (TV) and Feed (Fe) — three
// densities of the same journey, shipped from one module because they read the
// same event log and must never disagree about it.
//
// All three are domain-neutral in the way that matters: they are handed a
// status, a list of events and an optional promise, and have no idea what a
// warehouse is. Anything with scans can mount them.

type TrackingEventLike = {
  occurredAt?: Date | null;
  statusCode?: string | null;
  statusDescription?: string | null;
  location?: string | null;
  isDelivered?: boolean | null;
};

type DeliveryWindowLike = {
  label?: string | null;
  relativeLabel?: string | null;
  isOverdue?: boolean;
};

function sortEvents(events: TrackingEventLike[] | undefined) {
  return [...(events ?? [])]
    .filter(Boolean)
    .sort(
      (a, b) =>
        (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0),
    );
}

function eventTime(d: Date | null | undefined) {
  if (!d) {
    return '';
  }
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hueVar(hue: string | undefined) {
  return htmlSafe(`--st-hue: ${hue ?? 'var(--muted-foreground)'}`);
}

// ── Tracking Status View (TV) ───────────────────────────────────────────────
// The compact rail. Four fixed stages, because a package's progress is only
// legible as a fraction of a known route. A package in exception shows the rail
// stalled where it stopped rather than pretending to advance — a progress bar
// that keeps moving while nothing happens is a lying affordance.
interface RailSignature {
  Args: {
    status?: string | null;
    deliveryWindow?: DeliveryWindowLike | null;
  };
  Element: HTMLDivElement;
}

export class TrackingStatusView extends GlimmerComponent<RailSignature> {
  get stages() {
    let reached = shipmentStageIndex(this.args.status);
    return SHIPMENT_PIPELINE.map((value, i) => ({
      value,
      label: shipmentStatusStyle(value).label,
      hue: shipmentStatusStyle(value).hue,
      done: reached >= 0 && i <= reached,
      current: i === reached,
    }));
  }

  get isException() {
    return isShipmentException(this.args.status);
  }

  get exceptionLabel() {
    return shipmentStatusStyle(this.args.status).label;
  }

  <template>
    <div class='rail' ...attributes>
      <ol class='stages'>
        {{#each this.stages as |stage|}}
          <li
            class='stage {{if stage.done "done"}} {{if stage.current "current"}}'
            style={{hueVar stage.hue}}
          >
            <span class='node' aria-hidden='true'></span>
            <span class='label'>{{stage.label}}</span>
          </li>
        {{/each}}
      </ol>

      {{#if this.isException}}
        <p class='exception'>Stalled: {{this.exceptionLabel}}</p>
      {{else if @deliveryWindow.label}}
        <p class='promise'>
          Due
          <strong>{{@deliveryWindow.label}}</strong>
          {{#if @deliveryWindow.relativeLabel}}
            <span
              class='{{if @deliveryWindow.isOverdue "overdue"}}'
            >({{@deliveryWindow.relativeLabel}})</span>
          {{/if}}
        </p>
      {{/if}}
    </div>

    <style scoped>
      .rail {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .stages {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 1fr;
        gap: 0;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .stage {
        position: relative;
        display: grid;
        gap: 6px;
        justify-items: start;
        padding-right: 8px;
      }
      /* The connector is drawn by the stage itself so the rail survives any
         number of stages without a hardcoded width. */
      .stage::before {
        content: '';
        position: absolute;
        top: 5px;
        left: 0;
        right: 0;
        height: 2px;
        background: color-mix(in oklch, var(--foreground) 12%, transparent);
      }
      .stage.done::before {
        background: color-mix(in oklch, var(--st-hue) 45%, transparent);
      }
      .stage:last-child::before {
        right: 8px;
      }
      .node {
        position: relative;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--background, var(--boxel-light));
        border: 2px solid color-mix(in oklch, var(--foreground) 18%, transparent);
      }
      .stage.done .node {
        border-color: color-mix(in oklch, var(--st-hue) 60%, transparent);
        background: color-mix(in oklch, var(--st-hue) 60%, transparent);
      }
      .stage.current .node {
        box-shadow: 0 0 0 4px color-mix(in oklch, var(--st-hue) 16%, transparent);
      }
      .label {
        font-size: 0.72rem;
        line-height: 1.2;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .stage.current .label {
        font-weight: 700;
        color: var(--foreground, var(--boxel-dark));
      }
      .promise,
      .exception {
        margin: 0;
        font-size: 0.8rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .promise strong {
        color: var(--foreground, var(--boxel-dark));
      }
      .overdue,
      .exception {
        font-weight: 700;
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 60%,
          var(--foreground, var(--boxel-dark))
        );
      }
      @container (width < 380px) {
        .label {
          font-size: 0.62rem;
        }
      }
    </style>
  </template>
}

// ── Feed (Fe) ───────────────────────────────────────────────────────────────
// The scan log, newest last, the way a carrier prints it. Empty is a designed
// state: a package with no scans yet is normal for the first few hours, and
// saying so is more useful than an empty box.
interface FeedSignature {
  Args: {
    events?: TrackingEventLike[];
    emptyMessage?: string;
  };
  Element: HTMLDivElement;
}

export class TrackingEventFeed extends GlimmerComponent<FeedSignature> {
  get ordered() {
    // Read each property explicitly rather than spreading: these are field
    // instances, whose values live on prototype accessors that a spread would
    // silently drop.
    return sortEvents(this.args.events).map((e, i, all) => ({
      when: eventTime(e.occurredAt),
      statusDescription: e.statusDescription,
      location: e.location,
      isLatest: i === all.length - 1,
    }));
  }

  <template>
    <div class='feed' ...attributes>
      {{#if this.ordered.length}}
        <ol class='events'>
          {{#each this.ordered as |event|}}
            <li class='event {{if event.isLatest "latest"}}'>
              <span class='marker' aria-hidden='true'></span>
              <div class='body'>
                <span class='when'>{{event.when}}</span>
                <span class='what'>{{event.statusDescription}}</span>
                {{#if event.location}}
                  <span class='where'>{{event.location}}</span>
                {{/if}}
              </div>
            </li>
          {{/each}}
        </ol>
      {{else}}
        <p class='empty'>{{if
            @emptyMessage
            @emptyMessage
            'No carrier scans yet. The first one usually appears within a few
            hours of handover.'
          }}</p>
      {{/if}}
    </div>

    <style scoped>
      .feed {
        min-width: 0;
      }
      .events {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 0;
      }
      .event {
        position: relative;
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-sm);
      }
      /* The spine runs through the markers rather than beside them, so the
         column stays aligned however long a description wraps. */
      .event::before {
        content: '';
        position: absolute;
        left: 5px;
        top: 12px;
        bottom: 0;
        width: 2px;
        background: color-mix(in oklch, var(--foreground) 10%, transparent);
      }
      .event:last-child::before {
        display: none;
      }
      .marker {
        margin-top: 4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: color-mix(in oklch, var(--foreground) 25%, transparent);
      }
      .event.latest .marker {
        width: 12px;
        height: 12px;
        margin-top: 2px;
        margin-left: -2px;
        background: color-mix(in oklch, var(--foreground) 60%, transparent);
      }
      .body {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .when {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.72rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .what {
        font-size: 0.88rem;
        font-weight: 600;
        color: var(--foreground, var(--boxel-dark));
      }
      .event.latest .what {
        font-weight: 800;
      }
      .where {
        font-size: 0.78rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .empty {
        margin: 0;
        font-size: 0.85rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
    </style>
  </template>
}

// ── Shipment Tracker (ST) ───────────────────────────────────────────────────
// The composed surface: rail on top, log beneath, and the carrier's own page
// one click away. Composition rather than a third implementation, so a fix to
// either half lands in all three consumers at once.
interface TrackerSignature {
  Args: {
    status?: string | null;
    events?: TrackingEventLike[];
    deliveryWindow?: DeliveryWindowLike | null;
    trackingUrl?: string | null;
    compact?: boolean;
  };
  Element: HTMLDivElement;
}

export class ShipmentTracker extends GlimmerComponent<TrackerSignature> {
  <template>
    <div class='tracker' ...attributes>
      <TrackingStatusView
        @status={{@status}}
        @deliveryWindow={{@deliveryWindow}}
      />

      {{#unless @compact}}
        <TrackingEventFeed @events={{@events}} class='log' />
      {{/unless}}

      {{#if @trackingUrl}}
        <a
          class='out'
          href={{@trackingUrl}}
          target='_blank'
          rel='noopener noreferrer'
        >Open on the carrier's site</a>
      {{/if}}
    </div>

    <style scoped>
      .tracker {
        display: grid;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .log {
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid var(--border, var(--boxel-border-color));
      }
      .out {
        justify-self: start;
        font-size: 0.8rem;
        color: var(--foreground, var(--boxel-dark));
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-color: color-mix(
          in oklch,
          var(--foreground, var(--boxel-dark)) 35%,
          transparent
        );
      }
    </style>
  </template>
}

export default ShipmentTracker;
