import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

import type { RealmMetaField } from 'https://cardstack.com/base/command';

import { eq } from '@cardstack/boxel-ui/helpers';
import { Pill } from '@cardstack/boxel-ui/components';

interface RealmTabsSignature {
  Args: {
    realms: RealmMetaField[];
    selectedRealm: string | null;
    onChange: (realm: string | null) => void;
  };
}

export class RealmTabs extends GlimmerComponent<RealmTabsSignature> {
  <template>
    <div class='realm-tabs' role='tablist' aria-label='Filter by realm'>
      <Pill
        @kind='button'
        class='realm-pill {{if (eq @selectedRealm null) "active"}}'
        aria-selected={{if (eq @selectedRealm null) 'true' 'false'}}
        {{on 'click' (fn @onChange null)}}
      >
        <:default>All Realms</:default>
      </Pill>
      {{#each @realms as |realm|}}
        <Pill
          @kind='button'
          class='realm-pill {{if (eq @selectedRealm realm.url) "active"}}'
          aria-selected={{if (eq @selectedRealm realm.url) 'true' 'false'}}
          title={{realm.url}}
          {{on 'click' (fn @onChange realm.url)}}
        >
          <:default>{{realm.info.name}}</:default>
        </Pill>
      {{/each}}
    </div>

    <style scoped>
      .realm-tabs {
        display: flex;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }

      .realm-pill {
        --pill-border-radius: 50px;
        --pill-font: var(--boxel-font-sm);
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp);
        background-color: var(--card, #ffffff);
        color: var(--foreground, #1f2328);
        border: 1px solid var(--border, #d0d7de);
      }

      .realm-pill.active {
        background-color: var(--foreground, #1f2328);
        color: var(--card, #ffffff);
        border-color: var(--foreground, #1f2328);
      }

      .realm-pill:not(.active):hover {
        background-color: var(--muted, #f6f8fa);
        border-color: var(--muted-foreground, #656d76);
      }
    </style>
  </template>
}
