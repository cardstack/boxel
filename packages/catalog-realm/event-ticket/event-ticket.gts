import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import MusicIcon from '@cardstack/boxel-icons/music';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';

export class EventTicketCard extends CardDef {
  static displayName = 'Event Ticket';
  static icon = MusicIcon;

  @field eventName = contains(StringField);
  @field artist = contains(StringField);
  @field venue = contains(StringField);
  @field eventDate = contains(DateField);
  @field eventTime = contains(StringField);
  @field ticketPrice = contains(NumberField);
  @field seatSection = contains(StringField);
  @field ticketType = contains(StringField);
  @field isAvailable = contains(BooleanField);

  @field title = contains(StringField, {
    computeVia: function (this: EventTicketCard) {
      try {
        const event = this.eventName ?? 'Unknown Event';
        const artist = this.artist ? ` - ${this.artist}` : '';
        return `${event}${artist}`;
      } catch (e) {
        console.error('EventTicketCard: Error computing title', e);
        return 'Event Ticket';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='ticket-card {{unless @model.isAvailable "sold-out"}}'>
        <div class='ticket-main'>
          <div class='ticket-header'>
            <div class='event-info'>
              <h3 class='event-name'>{{if
                  @model.eventName
                  @model.eventName
                  'Unknown Event'
                }}</h3>
              {{#if @model.artist}}
                <p class='artist-name'>{{@model.artist}}</p>
              {{/if}}
            </div>

            <div class='ticket-price'>
              {{#if @model.ticketPrice}}
                <span class='price'> $ {{@model.ticketPrice}}</span>
              {{else}}
                <span class='price'>TBA</span>
              {{/if}}
            </div>
          </div>

          <div class='event-details'>
            <div class='detail-item'>
              <svg
                class='detail-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
                <line x1='16' y1='2' x2='16' y2='6' />
                <line x1='8' y1='2' x2='8' y2='6' />
                <line x1='3' y1='10' x2='21' y2='10' />
              </svg>
              <span class='detail-text'>
                {{#if @model.eventDate}}
                  {{formatDateTime @model.eventDate size='medium'}}
                {{else}}
                  Date TBA
                {{/if}}
                {{#if @model.eventTime}}
                  at
                  {{@model.eventTime}}
                {{/if}}
              </span>
            </div>

            <div class='detail-item'>
              <svg
                class='detail-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' />
                <circle cx='12' cy='10' r='3' />
              </svg>
              <span class='detail-text'>{{if
                  @model.venue
                  @model.venue
                  'Venue TBA'
                }}</span>
            </div>

            {{#if @model.seatSection}}
              <div class='detail-item'>
                <svg
                  class='detail-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M5 12s2.545-5 7-5c4.454 0 7 5 7 5s-2.546 5-7 5c-4.455 0-7-5-7-5z'
                  />
                  <path d='M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' />
                  <path d='M21 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2' />
                  <path d='M21 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2' />
                </svg>
                <span class='detail-text'>Section {{@model.seatSection}}</span>
              </div>
            {{/if}}
          </div>
        </div>

        <div class='ticket-actions'>
          {{#if @model.isAvailable}}
            <Button class='buy-button' @variant='primary'>
              {{#if @model.ticketType}}
                Buy
                {{@model.ticketType}}
              {{else}}
                Buy Ticket
              {{/if}}
            </Button>
          {{else}}
            <Button class='sold-out-button' disabled>
              Sold Out
            </Button>
          {{/if}}
        </div>

        <div class='ticket-perforation'></div>
      </div>

      <style scoped>
        .ticket-card {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          position: relative;
          transition: all 0.3s ease;
          border: 2px solid #f3f4f6;
        }

        .ticket-card:hover:not(.sold-out) {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
          border-color: #3b82f6;
        }

        .ticket-card.sold-out {
          opacity: 0.6;
          filter: grayscale(50%);
        }

        .ticket-main {
          padding: 1.5rem;
          border-bottom: 2px dashed #e5e7eb;
        }

        .ticket-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .event-info {
          flex: 1;
          min-width: 0;
        }

        .event-name {
          font-size: 1.125rem;
          font-weight: 700;
          color: #1f2937;
          margin: 0 0 0.25rem 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .artist-name {
          font-size: 0.875rem;
          color: #6b7280;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ticket-price {
          margin-left: 1rem;
        }

        .price {
          font-size: 1.25rem;
          font-weight: 700;
          color: #059669;
          background: #d1fae5;
          padding: 0.375rem 0.75rem;
          border-radius: 8px;
        }

        .event-details {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .detail-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .detail-icon {
          width: 16px;
          height: 16px;
          color: #9ca3af;
          flex-shrink: 0;
        }

        .detail-text {
          font-size: 0.875rem;
          color: #6b7280;
        }

        .ticket-actions {
          padding: 1rem 1.5rem;
          background: #f9fafb;
        }

        .buy-button {
          width: 100%;
          background: #3b82f6;
          color: white;
          border: none;
          padding: 0.75rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .buy-button:hover {
          background: #2563eb;
          transform: translateY(-1px);
        }

        .sold-out-button {
          width: 100%;
          background: #9ca3af;
          color: white;
          border: none;
          padding: 0.75rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 700;
          cursor: not-allowed;
        }

        .ticket-perforation {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(100% - 60px);
          height: 2px;
          background: repeating-linear-gradient(
            to right,
            transparent,
            transparent 4px,
            #e5e7eb 4px,
            #e5e7eb 8px
          );
        }
      </style>
    </template>
  };
}
