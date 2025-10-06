import {
  CardDef,
  Component,
  field,
  contains,
  realmURL,
  StringField,
} from 'https://cardstack.com/base/card-api';

function removeFileExtension(cardUrl: string) {
  return cardUrl?.replace(/\.[^/.]+$/, '');
}

export class PersonCard extends CardDef {
  static displayName = 'Person';

  // Name of the person
  @field name = contains(StringField, {
    description: 'Name of the person',
  });
  @field title = contains(StringField, {
    computeVia: function (this: PersonCard) {
      return this.name;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get query() {
      return {
        filter: {
          type: {
            // @ts-expect-error "import.meta" is actually fine to here since
            //  were actually transpile this module in our realm server
            module: new URL('./family_photo_card.gts', import.meta.url).href,
            name: 'FamilyPhotoCard',
          },
        },
      };
    }
    get realms() {
      return [this.args.model[realmURL]!];
    }
    get realmHrefs() {
      return this.realms.map((url) => url.href);
    }
    <template>
      <style>
        .person {
          font-weight: bold;
        }
      </style>
      <div>
        <span class='person'>{{@model.name}}</span>
      </div>
      {{#let
        (component @context.prerenderedCardSearchComponent)
        as |PrerenderedCardSearch|
      }}
        <PrerenderedCardSearch
          @query={{this.query}}
          @format='fitted'
          @realms={{this.realmHrefs}}
          @isLive={{true}}
        >

          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
            {{#each cards as |card|}}
              <li
                class='card'
                {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                data-cards-grid-item={{removeFileExtension card.url}}
              >
                {{card.component}}
              </li>
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      {{/let}}
    </template>
  };

  static embedded = this.isolated;
}
