import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { operations } from '@cardstack/base/operations';
import LayoutDashboardIcon from '@cardstack/boxel-icons/layout-dashboard';

import { PatientRecord } from './patient-record';

class ClinicalDashboardIsolated extends Component<typeof ClinicalDashboard> {
  // A declared `query` is the one operation that is not awaited: the search
  // engine carries it out, so calling it starts a live search and `.query()`
  // answers the wire query behind it. Both are resolved once, here, because
  // each call builds a new one — a getter would hand the search component a
  // different query on every render and restart the search each time.
  //
  // It answers nothing when the session cannot say who the caller is: nobody
  // is signed in, or this is a render, which authenticates as itself rather
  // than as a viewer. A search compared against `actor()` has nothing to ask
  // in that case, which is what the empty branch below is for.
  myPatients = operations(PatientRecord).myPatients.query();
  onThisUnit = operations(PatientRecord).admittedOnUnit.query({
    careUnit: this.args.model.unitName ?? '',
  });

  <template>
    <section class='dashboard'>
      <header>
        <h1>{{@model.unitName}}</h1>
        <p class='posture' data-test-posture>
          <span class='posture-stamp'>Not access controlled</span>
          This list is scoped to the signed-in clinician because the search says
          so, not because the realm enforces it. Any caller who can read this
          realm can read every record in it.
        </p>
      </header>

      <h2>On this unit</h2>
      {{#if this.onThisUnit}}
        <@context.searchResultsComponent
          @query={{this.onThisUnit}}
          @mode='hover'
          as |results|
        >
          <ul class='rows' data-test-unit-patients>
            {{#each results.entries key='id' as |entry|}}
              <li class='row' data-test-unit-patient={{entry.id}}>
                <entry.component />
              </li>
            {{else}}
              <li class='row muted'>
                {{#if results.isLoading}}
                  Loading…
                {{else}}
                  No admitted patients on this unit.
                {{/if}}
              </li>
            {{/each}}
          </ul>
        </@context.searchResultsComponent>
      {{/if}}

      <h2>Yours</h2>
      {{#if this.myPatients}}
        <@context.searchResultsComponent
          @query={{this.myPatients}}
          @mode='hover'
          as |results|
        >
          <ul class='rows' data-test-my-patients>
            {{#each results.entries key='id' as |entry|}}
              <li class='row' data-test-my-patient={{entry.id}}>
                <entry.component />
              </li>
            {{else}}
              <li class='row muted'>
                {{#if results.isLoading}}
                  Loading…
                {{else}}
                  You are not the attending clinician on any admitted patient.
                {{/if}}
              </li>
            {{/each}}
          </ul>
        </@context.searchResultsComponent>
      {{else}}
        <p class='muted' data-test-no-viewer>Sign in to see the patients you
          are attending.</p>
      {{/if}}
    </section>

    <style scoped>
      .dashboard {
        container-type: inline-size;
        container-name: dashboard;
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      h1 {
        margin: 0;
        font-size: clamp(1.75rem, 4cqi, 2.75rem);
        line-height: 1.05;
        font-weight: 400;
        letter-spacing: -0.03em;
      }
      h2 {
        margin: 0;
        padding-bottom: var(--boxel-sp-xxs);
        border-bottom: 0.0625rem solid var(--border, var(--muted));
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground);
      }
      .posture {
        margin: var(--boxel-sp-xs) 0 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--foreground);
        color: var(--background);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .posture-stamp {
        margin-right: var(--boxel-sp-xxs);
        font-family: var(--font-mono, monospace);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        white-space: nowrap;
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .row {
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--muted);
        overflow: hidden;
      }
      .muted {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
    </style>
  </template>
}

// A ward list built from a saved search. Everything it renders comes from
// `PatientRecord.myPatients` — declared on the card type, next to the
// operations that write it.
export class ClinicalDashboard extends CardDef {
  static displayName = 'Clinical Dashboard';
  static icon = LayoutDashboardIcon;
  static prefersWideFormat = true;

  @field unitName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ClinicalDashboard) {
      return this.unitName?.length
        ? this.unitName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static isolated = ClinicalDashboardIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='dashboard-embedded'>{{@model.unitName}}</div>
      <style scoped>
        .dashboard-embedded {
          font-weight: 600;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='dashboard-fitted'>{{@model.unitName}}</div>
      <style scoped>
        .dashboard-fitted {
          padding: var(--boxel-sp-xs);
          font-weight: 600;
        }
      </style>
    </template>
  };
}
