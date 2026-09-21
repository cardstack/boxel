import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import UserIcon from '@cardstack/boxel-icons/user';

// A deliberately small card that evaluations copy into a fresh test workspace
// so the assistant has something existing to change. Keep it small: an
// evaluation's success criteria describe the edit against this exact shape.
export class Contact extends CardDef {
  static displayName = 'Contact';
  static icon = UserIcon;

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field phone = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='contact'>
        <h1><@fields.cardTitle /></h1>
        <dl>
          <dt>Phone</dt>
          <dd><@fields.phone /></dd>
        </dl>
      </article>
      <style scoped>
        .contact {
          padding: var(--boxel-sp-lg);
        }
        h1 {
          margin: 0 0 var(--boxel-sp);
          font: 700 var(--boxel-font-lg);
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: var(--boxel-sp-xs) var(--boxel-sp);
        }
        dt {
          color: var(--boxel-450);
          font: var(--boxel-font-sm);
        }
        dd {
          margin: 0;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='contact-embedded'>
        <strong><@fields.cardTitle /></strong>
        <span><@fields.phone /></span>
      </div>
      <style scoped>
        .contact-embedded {
          display: flex;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };
}
