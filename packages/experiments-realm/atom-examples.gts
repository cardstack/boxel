import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import {
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
  CardDef,
  Component,
  FieldDef,
  StringField,
} from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import AtomIcon from '@cardstack/boxel-icons/atom';
import { Button } from '@cardstack/boxel-ui/components';
import { Author } from './author';
import { Pet } from './pet';
import { Country } from './country';
import { TeamMember } from './sprint-task';
import { Company } from './crm/company';
import { Contact } from './crm/contact';
import { ContactLinkField } from './fields/contact-link';

class Isolated extends Component<typeof AtomExamples> {
  <template>
    <div class='atom-examples'>
      <h2>Atom Template</h2>
      <hr />
      <section>
        <h3>Contains & ContainsMany:</h3>
        <div>
          Name:
          <@fields.name @format='atom' />
        </div>
        <div>
          Names:
          <@fields.names @format='atom' />
        </div>
        <div>
          Date:
          <@fields.date @format='atom' />
        </div>
        <div>
          Dates:
          <@fields.dates @format='atom' />
        </div>
      </section>
      <hr />
      <section>
        <h3>Contains & ContainsMany - Compound Field:</h3>
        <div>
          Trip:
          <@fields.trip @format='atom' />
        </div>
        <div>
          Trips:
          <@fields.trips @format='atom' />
        </div>
        <h4>Custom atom template:</h4>
        <div>
          Contact Link:
          <@fields.contactLink @format='atom' />
        </div>
        <div>
          Contact Links:
          <@fields.contactLinks @format='atom' />
        </div>
      </section>
      <hr />
      <section>
        <h3>LinksTo & LinksToMany:</h3>
        <section>
          <h4>Using default atom template for Pet card:</h4>
          <div>
            Pet:
            <@fields.pet @format='atom' />
          </div>
          <div>
            Pets:
            <@fields.pets @format='atom' />
          </div>
          <h4>Default atom template without container:</h4>
          <div>
            Pet:
            <@fields.pet @format='atom' @displayContainer={{false}} />
          </div>
          <div>
            Pets:
            <@fields.pets @format='atom' @displayContainer={{false}} />
          </div>
        </section>
        <section>
          <h4>Using custom atom template for Author card:</h4>
          <div>
            Author:
            <@fields.author @format='atom' />
          </div>
          <div>
            Authors:
            <@fields.authors @format='atom' />
          </div>
          <h4>Custom atom template without container:</h4>
          <div>
            Author:
            <@fields.author @format='atom' @displayContainer={{false}} />
          </div>
          <div>
            Authors:
            <@fields.authors @format='atom' @displayContainer={{false}} />
          </div>
        </section>
      </section>
      <hr />
      <section>
        <h3>More examples with custom atom template:</h3>
        <Button {{on 'click' this.toggleContainer}}>Toggle Container</Button>
        <div>
          Team Member:
          <@fields.teamMember
            @format='atom'
            @displayContainer={{this.displayContainer}}
          />
        </div>
        <div>
          Team Members:
          <@fields.teamMembers
            @format='atom'
            @displayContainer={{this.displayContainer}}
          />
        </div>
        <div>
          Company:
          <@fields.company
            @format='atom'
            @displayContainer={{this.displayContainer}}
          />
        </div>
        <div>
          Companies:
          <@fields.companies
            @format='atom'
            @displayContainer={{this.displayContainer}}
          />
        </div>
        <div>
          Contact:
          <@fields.contact
            @format='atom'
            @displayContainer={{this.displayContainer}}
          />
        </div>
        <div>
          Contacts:
          <@fields.contacts
            @format='atom'
            @displayContainer={{this.displayContainer}}
          />
        </div>
      </section>
      <hr />
    </div>
    <style scoped>
      .atom-examples {
        padding: var(--boxel-sp-xl);
        background-color: var(--boxel-100);
      }
      .atom-examples div + div {
        margin-top: 1em;
      }
      button {
        margin-bottom: 1em;
      }
    </style>
  </template>

  @tracked displayContainer = false;
  toggleContainer = () => {
    this.displayContainer = !this.displayContainer;
  };
}

class Trip extends FieldDef {
  static displayName = 'Trip';
  @field cardTitle = contains(StringField);
  @field country = linksTo(Country);
  @field countries = linksToMany(Country);
}

export class AtomExamples extends CardDef {
  static displayName = 'Atom Examples';
  static icon = AtomIcon;
  @field name = contains(StringField);
  @field names = containsMany(StringField);
  @field date = contains(DateField);
  @field dates = containsMany(DateField);
  @field author = linksTo(Author);
  @field authors = linksToMany(Author);
  @field pet = linksTo(Pet);
  @field pets = linksToMany(Pet);
  @field trip = contains(Trip);
  @field trips = containsMany(Trip);
  @field teamMember = linksTo(TeamMember);
  @field teamMembers = linksToMany(TeamMember);
  @field company = linksTo(Company);
  @field companies = linksToMany(Company);
  @field contact = linksTo(Contact);
  @field contacts = linksToMany(Contact);
  @field contactLink = contains(ContactLinkField);
  @field contactLinks = containsMany(ContactLinkField);

  static isolated = Isolated;
}
