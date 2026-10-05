import { cached } from '@glimmer/tracking';
import LayoutDashboardIcon from '@cardstack/boxel-icons/layout-dashboard';
import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { operations } from '@cardstack/base/operations';

import { ServicePlanSchedule } from './service-plan-schedule';

class PortalIsolated extends Component<typeof SchoolPortal> {
  // The Education realm, resolved against this card's own URL. The portal
  // ships beside the code it uses, so a relative `educationRealm` keeps one
  // copy of it working wherever the three realms are mounted side by side.
  get educationRealm(): string | undefined {
    let { educationRealm, id } = this.args.model;
    if (!educationRealm || !id) {
      return undefined;
    }
    return new URL(educationRealm, id).href;
  }

  // `listMySchedules` is a saved search on `ServicePlanSchedule`. A provider
  // reads no realm, so the Education realm answers them through its policy's
  // `listMySchedules` grant. Cached so each render hands the search component
  // the same query rather than restarting the search.
  @cached
  get mySchedules() {
    let realm = this.educationRealm;
    if (!realm) {
      return undefined;
    }
    return operations(ServicePlanSchedule).listMySchedules.query(undefined, {
      realms: [realm],
    });
  }

  <template>
    <section class='portal'>
      <header>
        <h1>{{@model.schoolName}}</h1>
        <p class='subtle'>Staff portal</p>
      </header>

      <h2>My service-plan schedules</h2>
      {{#if this.mySchedules}}
        <@context.searchResultsComponent
          @query={{this.mySchedules}}
          @mode='hover'
          as |results|
        >
          <ul class='rows'>
            {{#each results.entries key='id' as |entry|}}
              <li class='row'><entry.component /></li>
            {{else}}
              <li class='row subtle'>
                {{#if results.isLoading}}
                  Loading…
                {{else}}
                  You do not provide any scheduled services.
                {{/if}}
              </li>
            {{/each}}
          </ul>
        </@context.searchResultsComponent>
      {{else}}
        <p class='subtle'>Sign in to see the schedules you provide.</p>
      {{/if}}
    </section>

    <style scoped>
      .portal {
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      h1 {
        margin: 0;
        font-size: var(--boxel-font-size-xl);
        line-height: var(--boxel-line-height-xl);
      }
      h2 {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground);
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
        background-color: var(--muted, var(--boxel-100));
        overflow: hidden;
      }
      .subtle {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

// The staff landing page. It lives in the Code realm, which every signed-in
// user can read, because a provider can read neither the Org nor the
// Education realm and still needs somewhere to start.
export class SchoolPortal extends CardDef {
  static displayName = 'School Portal';
  static icon = LayoutDashboardIcon;
  static prefersWideFormat = true;

  @field schoolName = contains(StringField);
  // The Education realm's URL, absolute or relative to this card.
  @field educationRealm = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: SchoolPortal) {
      return this.schoolName?.length
        ? this.schoolName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static isolated = PortalIsolated;
}
