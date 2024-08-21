import {
  Component,
  FieldDef,
  serialize,
  deserialize,
  BaseInstanceType,
  BaseDefConstructor,
  formatQuery,
  queryableValue,
} from 'https://cardstack.com/base/card-api';

import {
  primitive,
  Query,
  assertQuery,
  stringifyQuery,
  parseToQuery,
  Filter,
} from '@cardstack/runtime-common';

// @ts-ignore no types
import cssUrl from 'ember-css-url';

export interface FilterWithState {
  active: boolean;
  filter: Filter;
}
export class SortField extends FieldDef {
  // private chooseCard = restartableTask(async () => {
  //   let type = identifyCard(this.args.field.card) ?? baseCardRef;
  //   let chosenCard: CardDef | undefined = await chooseCard(
  //     { filter: { type } },
  //     {
  //       offerToCreate: { ref: type, relativeTo: undefined },
  //       createNewCard: this.cardContext?.actions?.createCard,
  //     },
  //   );
  //   if (chosenCard) {
  //     this.args.model.value = chosenCard;
  //   }
  // });
}

export class QueryField extends FieldDef {
  static [primitive]: Query;

  static [serialize](query: Query) {
    assertQuery(query);
    return stringifyQuery(query);
  }
  static async [deserialize]<T extends BaseDefConstructor>(this: T, val: any) {
    if (val === undefined || val === null) {
      return {} as BaseInstanceType<T>;
    }
    return parseToQuery(val) as BaseInstanceType<T>;
  }

  static [queryableValue](query: Query | undefined) {
    if (!query) {
      return undefined;
    }
    return stringifyQuery(query);
  }

  static [formatQuery](query: Query) {
    return stringifyQuery(query);
  }

  static edit = class Edit extends Component<typeof this> {
    get query() {
      return JSON.stringify(this.args.model, null, 2);
    }
    <template>
      {{this.query}}
    </template>
  };
}

export class BaseView extends Component<typeof QueryField> {
  <template>
    {{! Filter: }}
    {{!-- {{@model.filter}} --}}
    {{! Sort: }}
    {{!-- {{@model.name}} --}}
  </template>

  get getFilters() {
    return;
  }

  get getSorts() {
    return;
  }
}
