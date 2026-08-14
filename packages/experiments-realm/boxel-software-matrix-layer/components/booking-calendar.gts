import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

import { stateColor, type StateColor } from '../utils/index';
import { Calendar, type CalendarEvent } from './calendar';

/**
 * A calendar event that knows how full it is. `capacity` is the configured
 * ceiling (the Capacity field's total on the consumer's event card);
 * `booked` is the live claim count the consumer computed from its bookings.
 * Both optional — an event without them renders as a plain chip.
 */
export interface BookingCalendarEvent extends CalendarEvent {
  capacity?: number;
  booked?: number;
}

interface Signature {
  Args: {
    events: BookingCalendarEvent[];
    /** kind → color pair, same contract as the Calendar's. */
    kindColors?: Record<string, StateColor>;
    onSelectEvent?: (event: BookingCalendarEvent) => void;
    /** Remaining share at or below which an event reads as "limited". */
    limitedThreshold?: number;
  };
  Element: HTMLElement;
}

const DOTS = [0, 1, 2, 3, 4];

/**
 * The month grid read as a booking surface: every chip answers "can I still
 * get in?" at a glance — a five-dot availability meter while places remain,
 * an explicit SOLD OUT once none do. Composes the generic Calendar (chip
 * block) rather than drawing its own grid; deliberately no drag-reschedule
 * and no add button, because an audience browses fixtures, it does not move
 * them.
 *
 * Availability is presentation only: the numbers arrive computed by the
 * consumer (ceiling from its event's capacity, claims from its bookings) —
 * this component never counts anything itself.
 */
export class BookingCalendar extends GlimmerComponent<Signature> {
  dots = DOTS;

  remainingRatio = (event: BookingCalendarEvent): number | null => {
    if (!event.capacity || event.capacity <= 0 || event.booked == null) {
      return null;
    }
    return Math.max(0, (event.capacity - event.booked) / event.capacity);
  };

  isSoldOut = (event: BookingCalendarEvent): boolean => {
    return this.remainingRatio(event) === 0;
  };

  hasMeter = (event: BookingCalendarEvent): boolean => {
    let ratio = this.remainingRatio(event);
    return ratio != null && ratio > 0;
  };

  dotOn = (event: BookingCalendarEvent, dot: number): boolean => {
    let ratio = this.remainingRatio(event) ?? 0;
    return Math.ceil(ratio * DOTS.length) > dot;
  };

  meterStyle = (event: BookingCalendarEvent) => {
    let ratio = this.remainingRatio(event) ?? 0;
    let threshold = this.args.limitedThreshold ?? 0.15;
    let hue = ratio <= threshold ? 'amber' : 'green';
    return htmlSafe(`--meter-color: ${stateColor(hue).ring};`);
  };

  soldOutStyle = () => {
    return htmlSafe(`--meter-color: ${stateColor('red').ring};`);
  };

  select = (event: CalendarEvent) => {
    this.args.onSelectEvent?.(event as BookingCalendarEvent);
  };

  <template>
    <div class='booking-calendar' ...attributes>
      <Calendar
        @events={{@events}}
        @kindColors={{@kindColors}}
        @onSelectEvent={{this.select}}
      >
        <:chip as |event|>
          <span class='bc-chip'>
            <span class='bc-title'>{{event.title}}</span>
            {{#if (this.isSoldOut event)}}
              <span class='bc-soldout' style={{this.soldOutStyle}}>Sold out</span>
            {{else if (this.hasMeter event)}}
              <span
                class='bc-meter'
                style={{this.meterStyle event}}
                aria-hidden='true'
              >
                {{#each this.dots as |dot|}}
                  <span class='bc-dot {{if (this.dotOn event dot) "on"}}' />
                {{/each}}
              </span>
            {{/if}}
          </span>
        </:chip>
      </Calendar>
      <p class='bc-legend'>
        <span class='bc-legend-item'><span
            class='bc-dot on bc-legend-green'
          /> places remaining</span>
        <span class='bc-legend-item'><span
            class='bc-dot on bc-legend-amber'
          /> few left</span>
        <span class='bc-legend-item'><span class='bc-soldout-swatch' /> sold
          out</span>
      </p>
    </div>
    <style scoped>
      .booking-calendar {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .bc-chip {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }
      .bc-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }
      .bc-meter {
        display: inline-flex;
        gap: 2px;
        flex: none;
        margin-left: auto;
      }
      .bc-dot {
        width: 0.25rem;
        height: 0.25rem;
        border-radius: 50%;
        background: var(--meter-color, currentColor);
        opacity: 0.25;
      }
      .bc-dot.on {
        opacity: 1;
      }
      .bc-soldout {
        flex: none;
        margin-left: auto;
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--meter-color);
      }
      .bc-legend {
        display: flex;
        gap: var(--boxel-sp);
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .bc-legend-item {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .bc-legend-green {
        --meter-color: var(--boxel-success);
      }
      .bc-legend-amber {
        --meter-color: var(--boxel-warning);
      }
      .bc-soldout-swatch {
        width: 0.5rem;
        height: 0.125rem;
        background: var(--boxel-danger);
      }
    </style>
  </template>
}

export default BookingCalendar;
// touched for re-index
