import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { FittedCard, Pill } from '@cardstack/boxel-ui/components';
import HospitalIcon from '@cardstack/boxel-icons/building-hospital';

// The hospital a patient record is admitted to. It declares no operations of
// its own: it is the context a record is read in, and the set of care units a
// transfer moves a patient between.
export class HospitalFacility extends CardDef {
  static displayName = 'Hospital Facility';
  static icon = HospitalIcon;

  @field facilityName = contains(StringField);
  @field city = contains(StringField);
  @field careUnits = containsMany(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: HospitalFacility) {
      return this.facilityName?.length
        ? this.facilityName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='facility'>
        <header>
          <h1>{{@model.facilityName}}</h1>
          <p class='subtle'>{{@model.city}}</p>
        </header>
        <section>
          <h2>Care units</h2>
          <ul class='units'>
            {{#each @model.careUnits as |unit|}}
              <li><Pill @variant='secondary'>{{unit}}</Pill></li>
            {{else}}
              <li class='subtle'>No care units listed</li>
            {{/each}}
          </ul>
        </section>
      </article>

      <style scoped>
        .facility {
          container-type: inline-size;
          container-name: facility;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          line-height: var(--boxel-line-height-xl);
          letter-spacing: -0.01em;
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground);
        }
        .subtle {
          margin: 0;
          color: var(--muted-foreground);
        }
        .units {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xxs);
        }
        @container facility (max-width: 24rem) {
          .facility {
            padding: var(--boxel-sp);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='facility-embedded'>
        <HospitalIcon width='20' height='20' />
        <span class='name'>{{@model.facilityName}}</span>
        <span class='city'>{{@model.city}}</span>
      </div>

      <style scoped>
        .facility-embedded {
          display: grid;
          grid-template-columns: auto 1fr;
          grid-template-rows: auto auto;
          align-items: center;
          column-gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        .facility-embedded > :global(svg) {
          grid-row: 1 / span 2;
          color: var(--muted-foreground);
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .city {
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <FittedCard @titleTag='h2'>
        <:placeholder><HospitalIcon width='28' height='28' /></:placeholder>
        <:eyebrow>Facility</:eyebrow>
        <:title>{{@model.facilityName}}</:title>
        <:subtitle>{{@model.city}}</:subtitle>
      </FittedCard>
    </template>
  };
}
