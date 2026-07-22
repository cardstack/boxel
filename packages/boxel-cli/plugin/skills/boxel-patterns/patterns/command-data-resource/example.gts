import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/tools/get-all-realm-metas';
import type {
  GetAllRealmMetasResult,
  RealmMetaField,
} from 'https://cardstack.com/base/command';

// 🧩 PATTERN: commandData<T> reactive resource
//
// Wraps any host Command into an ember-resource. The template reads
// `isSuccess`, `cardResult`, `cardError` and re-renders when they change.

export class RealmPicker extends CardDef {
  static displayName = 'Realm Picker';

  @field selectedRealm = contains(StringField);

  static isolated = class extends Component<typeof RealmPicker> {
    // 🎯 The resource: typed with the result CardDef class.
    realmsResource = commandData<typeof GetAllRealmMetasResult>(
      this,
      GetAllRealmMetasCommand,
    );

    get writableRealms(): RealmMetaField[] {
      let r = this.realmsResource;
      if (r?.isSuccess && r.cardResult) {
        let result = r.cardResult as GetAllRealmMetasResult;
        return (result.results ?? []).filter((rm) => rm.canWrite);
      }
      return [];
    }

    <template>
      {{#if this.realmsResource.isSuccess}}
        <ul>
          {{#each this.writableRealms as |realm|}}
            <li>{{realm.realmIdentifier}}</li>
          {{else}}
            <li>(no writable realms)</li>
          {{/each}}
        </ul>
      {{else if this.realmsResource.cardError}}
        <p>Failed to load realms: {{this.realmsResource.cardError.message}}</p>
      {{else}}
        <p>Loading…</p>
      {{/if}}
    </template>
  };
}
