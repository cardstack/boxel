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
import {
  formatDateTime,
  formatCurrency,
  gt,
} from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';
import { QRField } from '../fields/qr-code';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

class EventTicketEmbedded extends Component<typeof EventTicketCard> {
  @tracked showQRModal = false;
  @tracked isPurchasing = false;

  get timeUntilEvent() {
    if (!this.args.model?.eventDate) return null;

    const eventDate = new Date(this.args.model.eventDate);
    const now = new Date();
    const diff = eventDate.getTime() - now.getTime();

    if (diff <= 0) return 'Event has started';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days} days, ${hours} hours`;
    return `${hours} hours`;
  }

  get availabilityPercentage() {
    const max = this.args.model?.maxCapacity ?? 100;
    const sold = this.args.model?.soldTickets ?? 0;
    return Math.round(((max - sold) / max) * 100);
  }

  @action
  async handleBuyTicket() {
    this.isPurchasing = true;

    // Simulate purchase processing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Generate QR code if it doesn't exist
    if (!this.args.model?.ticketQRCode?.data) {
      const ticketId = `TICKET-${this.args.model?.eventName
        ?.toUpperCase()
        .replace(/\s+/g, '-')}-${new Date().getFullYear()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;
      // In a real app, this would be saved to the server
      console.log('Generated ticket ID:', ticketId);
    }

    this.isPurchasing = false;
    this.showQRModal = true;
  }

  @action
  toggleQRCode() {
    this.showQRModal = !this.showQRModal;
  }

  @action
  shareEvent() {
    if (navigator.share) {
      navigator.share({
        title: this.args.model?.eventName || 'Music Event',
        text: `Check out this event: ${this.args.model?.eventName} featuring ${this.args.model?.artist}`,
        url: window.location.href,
      });
    }
  }

  @action
  stopPropagation(event: Event) {
    event.stopPropagation();
    event.preventDefault();
  }

  <template>
    <div class='ticket-card {{unless @model.isAvailable "sold-out"}}'>
      <!-- Availability indicator -->
      {{#if @model.isAvailable}}
        <div class='availability-badge'>
          <div
            class='availability-indicator
              {{if
                (gt this.availabilityPercentage 50)
                "high"
                (if (gt this.availabilityPercentage 20) "medium" "low")
              }}'
          ></div>
          <span class='availability-text'>{{this.availabilityPercentage}}%
            available</span>
        </div>
      {{/if}}

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
            {{#if this.timeUntilEvent}}
              <p class='countdown'>{{this.timeUntilEvent}} to go</p>
            {{/if}}
          </div>

          <div class='ticket-price'>
            {{#if @model.ticketPrice}}
              <span class='price'>{{formatCurrency
                  @model.ticketPrice
                  currency='USD'
                  size='medium'
                }}</span>
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
          <div class='action-buttons'>
            <Button
              class='buy-button {{if this.isPurchasing "purchasing"}}'
              @variant='primary'
              {{on 'click' this.handleBuyTicket}}
              {{on 'click' this.stopPropagation}}
              disabled={{this.isPurchasing}}
            >
              {{#if this.isPurchasing}}
                <div class='loading-spinner'></div>
                Processing...
              {{else if @model.ticketType}}
                Buy
                {{@model.ticketType}}
              {{else}}
                Buy Ticket
              {{/if}}
            </Button>

            <Button
              class='share-button'
              @variant='secondary'
              {{on 'click' this.shareEvent}}
              {{on 'click' this.stopPropagation}}
            >
              <svg
                class='share-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='18' cy='5' r='3' />
                <circle cx='6' cy='12' r='3' />
                <circle cx='18' cy='19' r='3' />
                <line x1='8.59' y1='13.51' x2='15.42' y2='17.49' />
                <line x1='15.41' y1='6.51' x2='8.59' y2='10.49' />
              </svg>
            </Button>
          </div>
        {{else}}
          <Button class='sold-out-button' disabled>
            Sold Out
          </Button>
        {{/if}}
      </div>

      <div class='ticket-perforation'></div>
    </div>

    <!-- QR Code Section (Expandable) - Only show in isolated/embedded -->
    {{#if this.showQRModal}}
      <div class='qr-section'>
        <div class='qr-section-header'>
          <h3>🎫 Your Digital Ticket</h3>
          <button
            class='close-qr-button'
            {{on 'click' this.toggleQRCode}}
            {{on 'click' this.stopPropagation}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='m18 15-6-6-6 6' />
            </svg>
          </button>
        </div>

        <div class='qr-content'>
          <div class='ticket-summary'>
            <div class='summary-item'>
              <strong>{{@model.eventName}}</strong>
            </div>
            <div class='summary-item'>
              {{@model.artist}}
              •
              {{@model.venue}}
            </div>
            <div class='summary-item'>
              {{formatDateTime @model.eventDate size='medium'}}
              {{#if @model.eventTime}}at {{@model.eventTime}}{{/if}}
            </div>
            {{#if @model.seatSection}}
              <div class='summary-item'>
                Section:
                {{@model.seatSection}}
              </div>
            {{/if}}
          </div>

          {{#if @model.ticketQRCode.data}}
            <div class='qr-code-display'>
              <div class='qr-code-wrapper'>
                <@fields.ticketQRCode @format='embedded' />
              </div>
            </div>
          {{else}}
            <div class='qr-pending'>
              <svg
                class='qr-pending-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <rect x='7' y='7' width='3' height='3' />
                <rect x='14' y='7' width='3' height='3' />
                <rect x='7' y='14' width='3' height='3' />
                <rect x='14' y='14' width='3' height='3' />
              </svg>
              <p>QR Code will be activated after payment confirmation</p>
            </div>
          {{/if}}

        </div>
      </div>
    {{/if}}

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

      .availability-badge {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 255, 255, 0.95);
        padding: 4px 8px;
        border-radius: 12px;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        z-index: 1;
      }

      .availability-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        animation: pulse 2s infinite;
      }

      .availability-indicator.high {
        background: #10b981;
      }

      .availability-indicator.medium {
        background: #f59e0b;
      }

      .availability-indicator.low {
        background: #ef4444;
      }

      .availability-text {
        font-size: 0.75rem;
        font-weight: 600;
        color: #374151;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
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

      .countdown {
        font-size: 0.75rem;
        color: #8b5cf6;
        margin: 0.25rem 0 0 0;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .countdown::before {
        content: '⏰';
        font-size: 0.875rem;
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

      .action-buttons {
        display: flex;
        gap: 0.75rem;
      }

      .buy-button {
        flex: 1;
        background: #3b82f6;
        color: white;
        border: none;
        padding: 0.75rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        position: relative;
      }

      .buy-button:hover:not(:disabled) {
        background: #2563eb;
        transform: translateY(-1px);
      }

      .buy-button:disabled {
        opacity: 0.8;
        cursor: not-allowed;
      }

      .buy-button.purchasing {
        background: #6366f1;
      }

      .loading-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .share-button {
        width: auto;
        background: #6b7280;
        color: white;
        border: none;
        padding: 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .share-button:hover {
        background: #4b5563;
        transform: translateY(-1px);
      }

      .share-icon {
        width: 16px;
        height: 16px;
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

      /* QR Section Styles (Replaces Modal) */
      .qr-section {
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        border-top: 2px solid #0ea5e9;
        animation: slideDown 0.3s ease-out;
        overflow: hidden;
        position: relative;
        z-index: 1;
      }

      @keyframes slideDown {
        from {
          opacity: 0;
          max-height: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          max-height: 500px;
          transform: translateY(0);
        }
      }

      .qr-section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        background: rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid rgba(14, 165, 233, 0.2);
      }

      .qr-section-header h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 700;
        color: #0f172a;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .close-qr-button {
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(14, 165, 233, 0.3);
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 8px;
        color: #0ea5e9;
        transition: all 0.2s ease;
      }

      .close-qr-button:hover {
        background: white;
        border-color: #0ea5e9;
        transform: translateY(-1px);
      }

      .close-qr-button svg {
        width: 16px;
        height: 16px;
      }

      .qr-content {
        padding: 1.5rem;
      }

      .ticket-summary {
        background: white;
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(14, 165, 233, 0.1);
      }

      .summary-item {
        font-size: 0.875rem;
        color: #475569;
        margin-bottom: 0.5rem;
        line-height: 1.4;
      }

      .summary-item:last-child {
        margin-bottom: 0;
      }

      .summary-item strong {
        color: #0f172a;
        font-weight: 700;
      }

      .qr-code-display {
        text-align: center;
        margin-bottom: 1.5rem;
      }

      .qr-code-wrapper {
        background: white;
        border-radius: 16px;
        padding: 2rem;
        display: inline-block;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(14, 165, 233, 0.2);
        margin-bottom: 1rem;
      }

      .qr-pending {
        text-align: center;
        padding: 2rem;
        color: #94a3b8;
      }

      .qr-pending-icon {
        width: 48px;
        height: 48px;
        margin: 0 auto 1rem;
        opacity: 0.6;
      }

      .qr-pending p {
        font-size: 0.875rem;
        margin: 0;
      }
    </style>
  </template>
}

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
  @field ticketQRCode = contains(QRField);
  @field maxCapacity = contains(NumberField);
  @field soldTickets = contains(NumberField);

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

  static embedded = EventTicketEmbedded;
}
