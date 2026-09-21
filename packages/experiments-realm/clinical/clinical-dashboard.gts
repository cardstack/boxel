import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { operations } from '@cardstack/base/operations';

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
          This list is scoped to the signed-in clinician because the search
          says so, not because the realm enforces it. Any caller who can read
          this realm can read every record in it.
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
        padding: var(--boxel-sp);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      h1 {
        margin: 0;
      }
      .posture {
        margin: var(--boxel-sp-xs) 0 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-left: 0.25rem solid var(--primary);
        background-color: var(--muted);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
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

  @field unitName = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: ClinicalDashboard) {
      return this.unitName;
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
