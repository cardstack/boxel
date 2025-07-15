import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import UrlField from 'https://cardstack.com/base/url';
import { dayjsFormat } from '@cardstack/boxel-ui/helpers';
import PlaneIcon from '@cardstack/boxel-icons/plane';
import ClockIcon from '@cardstack/boxel-icons/clock';
import { BasicFitted } from '@cardstack/boxel-ui/components';

export class Flight extends CardDef {
  static displayName = 'Flight';

  @field airline = contains(StringField);
  @field flightNumber = contains(StringField);
  @field departureCity = contains(StringField);
  @field arrivalCity = contains(StringField);
  @field departureAirport = contains(StringField);
  @field arrivalAirport = contains(StringField);
  @field departureTime = contains(DatetimeField);
  @field arrivalTime = contains(DatetimeField);
  @field duration = contains(StringField);
  @field aircraftType = contains(StringField);
  @field price = contains(NumberField);
  @field cabinClass = contains(StringField);
  @field airlineLogo = contains(UrlField);

  @field formattedPrice = contains(StringField, {
    computeVia: function (this: Flight) {
      try {
        // Check if price is a number and not undefined/null
        if (typeof this.price === 'number') {
          // Use native JavaScript Intl.NumberFormat for reliable formatting
          return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
          }).format(this.price);
        }
        return '$0';
      } catch (e) {
        console.error('Error formatting flight price:', e);
        return '$0';
      }
    },
  });

  @field route = contains(StringField, {
    computeVia: function (this: Flight) {
      try {
        return `${this.departureAirport || this.departureCity || ''} → ${
          this.arrivalAirport || this.arrivalCity || ''
        }`;
      } catch (e) {
        console.error('Error computing route:', e);
        return '';
      }
    },
  });

  @field displayAirline = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.airline || 'Unknown Airline';
    },
  });

  @field displayFlightNumber = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.flightNumber || 'No Flight Number';
    },
  });

  @field displayCabinClass = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.cabinClass || 'No Cabin Class';
    },
  });

  @field displayDepartureAirport = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.departureAirport || 'Unknown Departure Airport';
    },
  });

  @field displayDepartureCity = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.departureCity || 'Unknown Departure City';
    },
  });

  @field displayArrivalAirport = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.arrivalAirport || 'Unknown Arrival Airport';
    },
  });

  @field displayArrivalCity = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.arrivalCity || 'Unknown Arrival City';
    },
  });

  @field displayDuration = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.duration || 'Unknown Duration';
    },
  });

  @field displayRoute = contains(StringField, {
    computeVia: function (this: Flight) {
      return this.route || 'Unknown Route';
    },
  });

  static isolated = class Isolated extends Component<typeof Flight> {
    <template>
      <div class='flight-card'>
        <div class='flight-header'>
          <div class='airline-info'>
            {{#if @model.airlineLogo}}
              <img
                src={{@model.airlineLogo}}
                alt={{@model.airline}}
                class='airline-logo'
              />
            {{else}}
              <div class='airline-logo-placeholder'></div>
            {{/if}}
            <div>
              <h2 class='airline-name'>{{@model.displayAirline}}</h2>
              <span class='flight-number'>{{@model.displayFlightNumber}}</span>
            </div>
          </div>
          <div class='price-display'>
            <span class='price'>{{@model.formattedPrice}}</span>
            <span class='cabin-class'>{{@model.displayCabinClass}}</span>
          </div>
        </div>

        <div class='flight-details'>
          <div class='route-info'>
            <div class='departure'>
              <div class='time'>
                {{#if @model.departureTime}}
                  {{dayjsFormat @model.departureTime 'h:mm A'}}
                {{else}}
                  <span class='placeholder'>--:--</span>
                {{/if}}</div>
              <div class='airport'>{{@model.displayDepartureAirport}}</div>
              <div class='city'>{{@model.displayDepartureCity}}</div>
            </div>

            <div class='flight-path'>
              <PlaneIcon width='24' height='24' class='plane-icon' />
              <div class='duration'>{{@model.displayDuration}}</div>
            </div>

            <div class='arrival'>
              <div class='time'>
                {{#if @model.arrivalTime}}
                  {{dayjsFormat @model.arrivalTime 'h:mm A'}}
                {{else}}
                  <span class='placeholder'>--:--</span>
                {{/if}}</div>
              <div class='airport'>{{@model.displayArrivalAirport}}</div>
              <div class='city'>{{@model.displayArrivalCity}}</div>
            </div>
          </div>

          <div class='flight-meta'>
            <div class='meta-item'>
              <ClockIcon width='16' height='16' />
              <span>
                {{#if @model.departureTime}}
                  {{dayjsFormat @model.departureTime 'MMM D, YYYY'}}
                {{/if}}
              </span>
            </div>
            {{#if @model.aircraftType}}
              <div class='meta-item'>
                <PlaneIcon width='16' height='16' />
                <span>{{@model.aircraftType}}</span>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .flight-card {
          --expedia-blue: #1e243a;
          --expedia-yellow: #febf4f;
          --text-primary: #1e243a;
          --text-secondary: #6b7280;
          --border-color: #e5e7eb;
          background: white;
          padding: 24px;
          margin: 10px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          container-type: inline-size;
        }

        .flight-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--border-color);
          gap: 16px;
        }

        .airline-info {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .airline-logo {
          width: 40px;
          height: 40px;
          object-fit: contain;
          border-radius: 8px;
          background: #f9fafb;
          padding: 4px;
          flex-shrink: 0;
        }

        .airline-name {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .flight-number {
          font-size: 14px;
          color: var(--text-secondary);
        }

        .price-display {
          text-align: right;
          flex-shrink: 0;
        }

        .price {
          font-size: 24px;
          font-weight: 700;
          color: var(--expedia-blue);
          display: block;
        }

        .cabin-class {
          font-size: 12px;
          color: var(--text-secondary);
          text-transform: uppercase;
          font-weight: 600;
        }

        .route-info {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          gap: 16px;
        }

        .departure,
        .arrival {
          flex: 1;
          text-align: center;
        }

        .departure {
          text-align: left;
        }

        .arrival {
          text-align: right;
        }

        .time {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .airport {
          font-size: 16px;
          font-weight: 600;
          color: var(--expedia-blue);
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .city {
          font-size: 14px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .flight-path {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          position: relative;
          min-width: 80px;
        }

        .flight-path::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            var(--expedia-blue) 0%,
            var(--expedia-yellow) 50%,
            var(--expedia-blue) 100%
          );
          z-index: 0;
        }

        .plane-icon {
          background: white;
          color: var(--expedia-yellow);
          z-index: 1;
        }

        .duration {
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 600;
          background: white;
          padding: 0 8px;
          z-index: 1;
        }

        .flight-meta {
          display: flex;
          gap: 24px;
          padding-top: 16px;
          border-top: 1px solid var(--border-color);
          flex-wrap: wrap;
        }

        .meta-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .meta-item svg {
          color: var(--expedia-blue);
          flex-shrink: 0;
        }

        .airline-logo-placeholder {
          width: 40px;
          height: 40px;
          background: #f3f4f6;
          border-radius: 8px;
          border: 2px dashed #d1d5db;
          flex-shrink: 0;
        }

        .placeholder {
          color: #9ca3af;
          font-style: italic;
        }

        /* Container Query Breakpoints */
        @container (max-width: 400px) {
          .flight-card {
            padding: 16px;
          }

          .route-info {
            flex-direction: column;
            gap: 20px;
          }

          .departure,
          .arrival {
            text-align: center;
          }

          .flight-path {
            flex-direction: row;
            justify-content: center;
            gap: 30px;
          }

          .time {
            font-size: 20px;
          }

          .airport {
            font-size: 14px;
          }

          .city {
            font-size: 12px;
          }

          .flight-meta {
            gap: 16px;
          }

          .meta-item {
            font-size: 13px;
          }
        }

        @container (max-width: 400px) {
          .flight-card {
            padding: 12px;
          }

          .airline-info {
            gap: 8px;
          }

          .airline-logo {
            width: 32px;
            height: 32px;
          }

          .airline-name {
            font-size: 16px;
          }

          .flight-number {
            font-size: 12px;
          }

          .price {
            font-size: 20px;
          }

          .time {
            font-size: 18px;
          }

          .airport {
            font-size: 13px;
          }

          .city {
            font-size: 11px;
          }

          .flight-meta {
            gap: 12px;
          }

          .meta-item {
            font-size: 12px;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Flight> {
    <template>
      <div class='flight-embedded'>
        <div class='airline-section'>
          {{#if @model.airlineLogo}}
            <img
              src={{@model.airlineLogo}}
              alt={{@model.airline}}
              class='airline-logo'
            />
          {{else}}
            <div class='airline-logo-placeholder-embedded'></div>
          {{/if}}
          <div class='airline-details'>
            <div class='airline-name'>{{@model.displayAirline}}</div>
            <div class='flight-number'>{{@model.displayFlightNumber}}</div>
          </div>
        </div>

        <div class='route-section'>
          <div class='route'>{{@model.displayRoute}}</div>
          <div class='time-info'>
            {{#if @model.departureTime}}
              {{dayjsFormat @model.departureTime 'h:mm A'}}
            {{else}}
              <span class='placeholder'>--:--</span>
            {{/if}}
            -
            {{#if @model.arrivalTime}}
              {{dayjsFormat @model.arrivalTime 'h:mm A'}}
            {{else}}
              <span class='placeholder'>--:--</span>
            {{/if}}
          </div>

          <div class='duration'>{{@model.displayDuration}}</div>
        </div>

        <div class='price-section'>
          <div class='price'>{{@model.formattedPrice}}</div>
          <div class='cabin'>{{@model.displayCabinClass}}</div>
        </div>
      </div>

      <style scoped>
        .flight-embedded {
          --expedia-blue: #1e243a;
          --expedia-yellow: #febf4f;
          --text-primary: #1e243a;
          --text-secondary: #6b7280;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: #f9fafb;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          container-type: inline-size;
        }

        .airline-section {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 140px;
          flex-shrink: 0;
        }

        .airline-logo {
          width: 32px;
          height: 32px;
          object-fit: contain;
          border-radius: 6px;
          background: white;
          padding: 2px;
        }

        .airline-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .flight-number {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .route-section {
          flex: 1;
        }

        .route {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .time-info {
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 2px;
        }

        .duration {
          font-size: 11px;
          color: var(--expedia-blue);
          font-weight: 600;
        }

        .price-section {
          text-align: right;
          min-width: 80px;
          flex-shrink: 0;
        }

        .price {
          font-size: 16px;
          font-weight: 700;
          color: var(--expedia-blue);
        }

        .cabin {
          font-size: 10px;
          color: var(--text-secondary);
          text-transform: uppercase;
          font-weight: 600;
        }

        .airline-logo-placeholder-embedded {
          width: 32px;
          height: 32px;
          background: #f3f4f6;
          border-radius: 6px;
          border: 2px dashed #d1d5db;
        }

        /* Container Query Breakpoints */
        @container (max-width: 400px) {
          .flight-embedded {
            flex-direction: column;
            align-items: flex-start;
            gap: 20px;
            padding: 12px;
          }

          .route {
            font-size: 13px;
          }

          .time-info {
            font-size: 11px;
          }

          .duration {
            font-size: 10px;
          }

          .price {
            font-size: 14px;
          }

          .cabin {
            font-size: 9px;
          }

          .price-section {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Flight> {
    get isEmpty() {
      return !this.args.model;
    }

    get primary() {
      return this.args.model?.route || 'Flight Route';
    }

    get secondary() {
      if (!this.args.model) return '';

      const departure = this.args.model.departureTime
        ? dayjsFormat(this.args.model.departureTime, 'h:mm A')
        : '--:--';
      const arrival = this.args.model.arrivalTime
        ? dayjsFormat(this.args.model.arrivalTime, 'h:mm A')
        : '--:--';

      return `${departure} - ${arrival}`;
    }

    get thumbnailURL() {
      return this.args.model?.airlineLogo;
    }

    <template>
      <BasicFitted
        @primary={{this.primary}}
        @secondary={{this.secondary}}
        @thumbnailURL={{this.thumbnailURL}}
        @iconComponent={{PlaneIcon}}
        @isEmpty={{this.isEmpty}}
      />
    </template>
  };
}
