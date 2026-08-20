import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  realmURL,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateTimeField from '@cardstack/base/datetime';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';
import TicketIcon from '@cardstack/boxel-icons/ticket';

import { Contact } from './contact';
import { Event } from './event';
import RsvpStatusField from './rsvp-status-field';
import { statusField } from './status-field';

/**
 * Money state, separate from attendance intent: a booking can be Going and
 * unpaid, or Refunded and still attended (a goodwill refund). Waived covers
 * comps and zero-price bookings so "everything not Paid owes money" stays a
 * safe query.
 */
export const BookingPaymentStatusField = statusField({
  displayName: 'Payment Status',
  options: [
    { value: 'Unpaid', hue: 'amber', meaning: 'Owed — not yet settled' },
    { value: 'Paid', hue: 'green', meaning: 'Settled in full', holds: true },
    {
      value: 'Waived',
      hue: 'slate',
      meaning: 'Nothing owed — comp or zero price',
      holds: true,
    },
    {
      value: 'Refunded',
      hue: 'red',
      meaning: 'Returned to the payer',
      terminal: true,
      holds: true,
    },
  ],
  transitions: {
    Unpaid: ['Paid', 'Waived'],
    Paid: ['Refunded'],
    Waived: ['Unpaid'],
    Refunded: [],
  },
});

/**
 * A claim on places at an Event — who is coming, how many places, where the
 * money stands, and whether they actually showed up. Four facts, four
 * fields, deliberately not collapsed: `rsvp` is intent, `paymentStatus` is
 * money, `checkedInAt` is what happened, `quantity` is how much of the
 * capacity this claim consumes.
 *
 * `checkedInAt` is an event fact written once by the Check In Booking
 * command (which is also what makes a ticket one-time-use); anything
 * derived — attendance rates, no-show lists — is computed from it, never
 * stored. Seat-level assignment (section, row, seat) is a seating-plan
 * concern for the consumer's extending card.
 */
export class Booking extends CardDef {
  static displayName = 'Booking';
  static icon = TicketIcon;

  @field reference = contains(StringField);
  @field event = linksTo(Event);
  @field holder = linksTo(Contact);
  @field quantity = contains(NumberField);
  @field rsvp = contains(RsvpStatusField);
  @field paymentStatus = contains(BookingPaymentStatusField);
  @field totalPrice = contains(AmountWithCurrency);
  @field checkedInAt = contains(DateTimeField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Booking) {
      return (
        this.reference ??
        (this.holder?.name
          ? `Booking for ${this.holder.name}`
          : `Untitled ${this.constructor.displayName}`)
      );
    },
  });

  // Queryable read surface: lists and searches see who and what without
  // resolving the links themselves.
  @field eventTitle = contains(StringField, {
    computeVia: function (this: Booking) {
      return this.event?.cardTitle;
    },
  });

  @field holderName = contains(StringField, {
    computeVia: function (this: Booking) {
      return this.holder?.name;
    },
  });

  static atom = class Atom extends Component<typeof Booking> {
    <template>
      <span class='bk-atom'>
        <TicketIcon class='bk-icon' />
        <span class='bk-ref'>{{if
            @model.reference
            @model.reference
            'No reference'
          }}</span>
      </span>
      <style scoped>
        .bk-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.8125rem;
        }
        .bk-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, #6b7280);
        }
        .bk-ref {
          font-family: var(--font-mono, ui-monospace, monospace);
          letter-spacing: 0.04em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Booking> {
    get places() {
      let q = this.args.model.quantity ?? 1;
      return q === 1 ? '1 place' : `${q} places`;
    }
    <template>
      <div class='bk'>
        <div class='bk-id'>
          <span class='bk-ref'>{{if
              @model.reference
              @model.reference
              'No reference'
            }}</span>
          <span class='bk-meta'>
            {{if @model.holder.name @model.holder.name 'Unassigned'}}
            · {{this.places}}
            {{#if @model.checkedInAt}}· checked in{{/if}}
          </span>
        </div>
        <span class='bk-payment'>
          {{#if @model.paymentStatus}}
            <@fields.paymentStatus @format='atom' />
          {{/if}}
        </span>
        <span class='bk-rsvp'>
          {{#if @model.rsvp}}<@fields.rsvp @format='atom' />{{/if}}
        </span>
      </div>
      <style scoped>
        .bk {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
        }
        .bk-id {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .bk-ref {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.8125rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bk-meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Constant-width trailing slots so booking rows column-align. */
        .bk-payment {
          width: 4.5rem;
          display: inline-flex;
          justify-content: flex-end;
          flex-shrink: 0;
        }
        .bk-rsvp {
          width: 5.25rem;
          display: inline-flex;
          justify-content: flex-end;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Booking> {
    get places() {
      let q = this.args.model.quantity ?? 1;
      return q === 1 ? '1 place' : `${q} places`;
    }
    <template>
      <div class='fitted'>
        <span class='ref'>{{if
            @model.reference
            @model.reference
            'No reference'
          }}</span>
        <span class='meta line-places'>{{this.places}}</span>
        <span class='line-rsvp'>
          {{#if @model.rsvp}}<@fields.rsvp @format='atom' />{{/if}}
        </span>
        {{#if @model.checkedInAt}}
          <span class='meta line-checkin'>Checked in
            <@fields.checkedInAt /></span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
        }
        .ref {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .line-places,
        .line-rsvp,
        .line-checkin {
          display: none;
        }
        /* Badge degradation: strip height keeps only the first line. */
        @container fitted-card (max-height: 50px) {
          .fitted {
            padding: 0.25rem 0.5rem;
            gap: 0.125rem;
          }
        }
        @container fitted-card (min-height: 65px) {
          .line-rsvp {
            display: inline-flex;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-places {
            display: block;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .line-checkin {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Booking> {
    @tracked runningAction: 'confirm' | 'check-in' | undefined;
    @tracked actionProblem: string | undefined;

    get places() {
      let q = this.args.model.quantity ?? 1;
      return q === 1 ? '1 place' : `${q} places`;
    }

    get realm(): string | undefined {
      return this.args.model?.[realmURL]?.href;
    }

    /** Commands need a live command context and a saved card. */
    get canAct(): boolean {
      return Boolean(
        this.args.context?.commandContext && this.args.model?.id && this.realm,
      );
    }

    get canConfirm(): boolean {
      let m = this.args.model;
      return (
        this.canAct &&
        !m.checkedInAt &&
        m.rsvp !== 'Going' &&
        m.rsvp !== 'Declined'
      );
    }

    get canCheckIn(): boolean {
      let m = this.args.model;
      return this.canAct && !m.checkedInAt && m.rsvp !== 'Declined';
    }

    private runCommand = async (
      kind: 'confirm' | 'check-in',
      _event?: Event,
    ) => {
      let context = this.args.context?.commandContext;
      if (!context || !this.realm) {
        return;
      }
      this.runningAction = kind;
      this.actionProblem = undefined;
      try {
        // Literal lazy imports: both commands import Booking back, so a
        // static import here would be a module cycle.
        if (kind === 'confirm') {
          let { default: ConfirmBookingCommand } = await import(
            './confirm-booking'
          );
          await new ConfirmBookingCommand(context).execute({
            booking: this.args.model,
            realm: this.realm,
          } as any);
        } else {
          let { default: CheckInBookingCommand } = await import(
            './check-in-booking'
          );
          await new CheckInBookingCommand(context).execute({
            booking: this.args.model,
            realm: this.realm,
          } as any);
        }
      } catch (error: any) {
        this.actionProblem = error?.message ?? String(error);
      } finally {
        this.runningAction = undefined;
      }
    };

    confirm = (_event?: Event) => this.runCommand('confirm');
    checkIn = (_event?: Event) => this.runCommand('check-in');

    <template>
      <article class='bk-page'>
        <header class='bh'>
          <div class='bh-id'>
            <p class='doc-kind'>Booking</p>
            <h1>{{if @model.reference @model.reference 'No reference'}}</h1>
            <p class='bh-places'>{{this.places}}</p>
          </div>
          <div class='bh-standing'>
            {{#if @model.rsvp}}<@fields.rsvp @format='embedded' />{{/if}}
            {{#if @model.paymentStatus}}
              <@fields.paymentStatus @format='embedded' />
            {{/if}}
          </div>
        </header>
        {{#if @model.event}}
          <section class='panel'>
            <h2>Event</h2>
            <div class='linked'><@fields.event @format='embedded' /></div>
          </section>
        {{/if}}
        {{#if @model.holder}}
          <section class='panel'>
            <h2>Holder</h2>
            <div class='linked'><@fields.holder @format='embedded' /></div>
          </section>
        {{/if}}
        <section class='panel'>
          <h2>Attendance</h2>
          {{#if @model.checkedInAt}}
            <p class='fact'>Checked in <@fields.checkedInAt /></p>
          {{else}}
            <p class='fact fact-empty'>Not checked in</p>
            {{#if this.canCheckIn}}
              <div class='actions'>
                {{#if this.canConfirm}}
                  <Button
                    @kind='secondary-light'
                    @size='small'
                    @loading={{eq this.runningAction 'confirm'}}
                    {{on 'click' this.confirm}}
                  >Confirm</Button>
                {{/if}}
                <Button
                  @kind='primary'
                  @size='small'
                  @loading={{eq this.runningAction 'check-in'}}
                  {{on 'click' this.checkIn}}
                >Check in</Button>
              </div>
            {{/if}}
            {{#if this.actionProblem}}
              <p class='problem' role='alert'>{{this.actionProblem}}</p>
            {{/if}}
          {{/if}}
        </section>
        {{#if @model.totalPrice.amount}}
          <section class='panel'>
            <h2>Price</h2>
            <div class='price'><@fields.totalPrice /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .bk-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .bh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .bh-id {
          flex: 1;
          min-width: 0;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.5rem;
          line-height: 1.1;
          font-family: var(--font-mono, ui-monospace, monospace);
          letter-spacing: 0.04em;
        }
        .bh-places {
          margin: 0.25rem 0 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .bh-standing {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.375rem;
          flex-shrink: 0;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .linked {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
        .fact {
          margin: 0;
          font-size: 0.875rem;
        }
        .fact-empty {
          font-style: italic;
          color: var(--muted-foreground, #6b7280);
        }
        .actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.75rem;
        }
        .problem {
          margin: 0.75rem 0 0;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          background: color-mix(
            in oklch,
            var(--destructive, #b91c1c) 12%,
            var(--card, #ffffff)
          );
          color: color-mix(
            in oklch,
            var(--destructive, #b91c1c) 55%,
            var(--foreground, #111111)
          );
          font-size: 0.8125rem;
        }
        .price {
          font-size: 0.9375rem;
          font-weight: 600;
        }
      </style>
    </template>
  };
}
