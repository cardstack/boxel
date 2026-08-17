import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import AddressField from '@cardstack/base/address';
import PhoneNumberField from '@cardstack/base/phone-number';
import WebsiteField from '@cardstack/base/website';
import MarkdownField from '@cardstack/base/markdown';
import GeoPointField from 'https://realms-staging.stack.cards/catalog/fields/geo-point/geo-point';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';

/**
 * A named physical place — somewhere things happen, ship to, or are held at.
 *
 * The block is the place itself: name, what kind of place it is, where it
 * stands and how to reach it. Everything a place means to one domain — a
 * stadium's capacity, a warehouse's racking, an office's desks — belongs on
 * the consumer's card, which links here or extends this. That split is what
 * lets one Location serve an event's venue and an order's pickup point
 * without either seeing the other's baggage.
 *
 * `kind` is a label in the consumer's vocabulary (Stadium, Office, Warehouse,
 * Clinic) — deliberately free text and never a lifecycle, so it is not
 * colour-coded.
 */
export class Location extends CardDef {
  static displayName = 'Location';
  static icon = MapPinIcon;

  @field name = contains(StringField);
  @field kind = contains(StringField);
  @field address = contains(AddressField);
  @field geo = contains(GeoPointField);
  @field phone = contains(PhoneNumberField);
  @field website = contains(WebsiteField);
  @field description = contains(MarkdownField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Location) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Location> {
    <template>
      <span class='loc-atom'>
        <MapPinIcon class='pin' />
        <span class='loc-name'>{{if
            @model.name
            @model.name
            'Unnamed Location'
          }}</span>
      </span>
      <style scoped>
        .loc-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .pin {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, #6b7280);
        }
        .loc-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Location> {
    get place() {
      let a = this.args.model?.address;
      return [a?.city, a?.country?.name ?? a?.state]
        .filter(Boolean)
        .join(', ');
    }
    <template>
      <div class='loc'>
        <span class='pin-disc'><MapPinIcon class='pin' /></span>
        <div class='info'>
          <div class='name'>{{if @model.name @model.name 'Unnamed'}}</div>
          {{#if this.place}}
            <div class='meta'>{{this.place}}</div>
          {{else}}
            <div class='meta muted-em'>No address on file</div>
          {{/if}}
        </div>
        {{#if @model.kind}}
          <span class='kind'>{{@model.kind}}</span>
        {{/if}}
      </div>
      <style scoped>
        .loc {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
        }
        .pin-disc {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .pin {
          width: 16px;
          height: 16px;
        }
        .info {
          min-width: 0;
          flex: 1;
        }
        .name {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .muted-em {
          font-style: italic;
        }
        .kind {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Location> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Location';
    }
    get place() {
      let a = this.args.model?.address;
      return [a?.city, a?.country?.name ?? a?.state]
        .filter(Boolean)
        .join(', ');
    }
    get street() {
      return this.args.model?.address?.addressLine1;
    }
    <template>
      <div class='fitted'>
        <span class='pin-disc'><MapPinIcon class='pin' /></span>
        <div class='info'>
          <span class='name'>{{this.name}}</span>
          {{#if @model.kind}}
            <span class='meta line-kind'>{{@model.kind}}</span>
          {{/if}}
          {{#if this.place}}
            <span class='meta line-place'>{{this.place}}</span>
          {{/if}}
          {{#if this.street}}
            <span class='meta line-street'>{{this.street}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fitted {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .pin-disc {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .pin {
          width: 14px;
          height: 14px;
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-kind,
        .line-place,
        .line-street {
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
          .line-place {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .fitted {
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            padding: 0.875rem;
          }
          .pin-disc {
            width: 36px;
            height: 36px;
          }
          .line-kind {
            display: block;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .line-street {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Location> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Location';
    }
    get hasGeo() {
      return this.args.model?.geo?.lat != null &&
        this.args.model?.geo?.lon != null;
    }
    get hasReach() {
      return Boolean(this.args.model?.phone || this.args.model?.website);
    }
    <template>
      <article class='loc-page'>
        <header class='lh'>
          <span class='pin-disc'><MapPinIcon class='pin' /></span>
          <div class='lh-id'>
            <p class='doc-kind'>Location</p>
            <h1>{{this.name}}</h1>
          </div>
          {{#if @model.kind}}
            <span class='kind'>{{@model.kind}}</span>
          {{/if}}
        </header>
        {{#if this.hasGeo}}
          <div class='map'><@fields.geo @format='embedded' /></div>
        {{/if}}
        <section class='panel'>
          <h2>Address</h2>
          {{#if @model.address.fullAddress}}
            <div class='addr'><@fields.address @format='embedded' /></div>
          {{else}}
            <p class='empty'>No address on file</p>
          {{/if}}
        </section>
        {{#if this.hasReach}}
          <section class='panel'>
            <h2>Reach</h2>
            <dl>
              {{#if @model.phone}}
                <dt>Phone</dt>
                <dd><@fields.phone /></dd>
              {{/if}}
              {{#if @model.website}}
                <dt>Website</dt>
                <dd><@fields.website /></dd>
              {{/if}}
            </dl>
          </section>
        {{/if}}
        {{#if @model.description}}
          <section class='panel'>
            <h2>About</h2>
            <div class='about'><@fields.description /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .loc-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .lh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .pin-disc {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .pin {
          width: 26px;
          height: 26px;
        }
        .lh-id {
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
          font-size: 1.625rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .kind {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .map {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          overflow: hidden;
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
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.5rem 1.25rem;
          font-size: 0.875rem;
          align-items: center;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
        .empty {
          margin: 0;
          font-size: 0.875rem;
          font-style: italic;
          color: var(--muted-foreground, #6b7280);
        }
        .about {
          font-size: 0.875rem;
          line-height: 1.6;
        }
      </style>
    </template>
  };
}
