import {
  CardDef,
  Component,
  field,
  contains,
  realmURL,
  StringField,
} from 'https://cardstack.com/base/card-api';

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
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

  // Total photos they appear in (computed)
  //  @field totalPhotos = contains(NumberField, {
  //    computeVia: function (this: PersonCard) {
  //     // Links to photos are dynamically counted
  //      return this.linksToMany(PhotoCard).length;
  //    },
  //  });

  static isolated = class Isolated extends Component<typeof this> {
    get query() {
      return {
        filter: {
          type: {
            // @ts-expect-error "import.meta" is actually fine to here since
            //  were actually transpile this module in our realm server
            module: new URL('./family_photo_card.gts', import.meta.url).href,
            // module: //'http://localhost:4201/user/personal/family_photo_card.gts',
            name: 'FamilyPhotoCard',
          },
        },
      };
    }
    get realms() {
      return [this.args.model[realmURL]];
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
          @realms={{this.realms}}
        >

          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
            {{#each cards as |card|}}
              <li
                class='card'
                {{@context.cardComponentModifier
                  cardId=card.url
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
                {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                data-cards-grid-item={{removeFileExtension card.url}}
              >
                {{! @glint-ignore the error in this module is that 'CardContainer' is not imported !}}
                <CardContainer @displayBoundaries='true'>
                  {{card.component}}
                  {{! @glint-ignore the error is this module is that 'CardContainer' is not imported !}}
                </CardContainer>
              </li>
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      {{/let}}
    </template>
  };

  static embedded = this.isolated;
}
