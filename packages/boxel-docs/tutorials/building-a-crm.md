# Tutorial: Building a CRM

This tutorial walks through building a complete CRM (Customer Relationship Management) application using Boxel cards. You'll create Contact, Company, Deal, and Task cards with rich relationships and multiple views.

## What We'll Build

A CRM application with:
- **Contacts** — People with name, email, phone, and company links
- **Companies** — Organizations with industry and contacts
- **Deals** — Sales opportunities linked to contacts
- **CRM App** — Main application card with tabs and filters

## Step 1: Define the Company Card

```typescript
// company.gts
import {
  CardDef, field, contains, containsMany, linksToMany, Component
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BuildingIcon from '@cardstack/boxel-icons/building';

export class Company extends CardDef {
  static displayName = 'Company';
  static icon = BuildingIcon;

  @field name = contains(StringField);
  @field industry = contains(StringField);
  @field website = contains(StringField);
  @field description = contains(StringField);

  static embedded = class Embedded extends Component<typeof Company> {
    <template>
      <div class="company-embed">
        <strong><@fields.name /></strong>
        <span class="industry"><@fields.industry /></span>
      </div>
      <style scoped>
        .company-embed {
          display: flex;
          gap: var(--boxel-sp-sm);
          align-items: center;
        }
        .industry {
          color: var(--boxel-400);
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };
}
```

## Step 2: Define Custom Fields

### Phone Number Field

```typescript
// fields/phone-number.gts
import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class PhoneNumber extends FieldDef {
  static displayName = 'Phone Number';

  @field countryCode = contains(StringField);
  @field number = contains(StringField);
  @field type = contains(StringField); // "mobile", "work", "home"

  static embedded = class extends Component<typeof PhoneNumber> {
    <template>
      <span class="phone">
        +{{@model.countryCode}} {{@model.number}}
        <small>({{@model.type}})</small>
      </span>
    </template>
  };
}
```

### Social Link Field

```typescript
// fields/social-link.gts
import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class SocialLink extends FieldDef {
  static displayName = 'Social Link';

  @field platform = contains(StringField);  // "LinkedIn", "Twitter", etc.
  @field url = contains(StringField);

  static embedded = class extends Component<typeof SocialLink> {
    <template>
      <a href={{@model.url}} class="social-link" target="_blank" rel="noopener">
        {{@model.platform}}
      </a>
    </template>
  };
}
```

## Step 3: Define the Contact Card

```typescript
// contact.gts
import {
  CardDef, field, contains, containsMany, linksTo, Component
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import EmailField from 'https://cardstack.com/base/email';
import ContactIcon from '@cardstack/boxel-icons/contact';
import { Company } from './company';
import { PhoneNumber } from './fields/phone-number';
import { SocialLink } from './fields/social-link';

export class Contact extends CardDef {
  static displayName = 'Contact';
  static icon = ContactIcon;

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(EmailField);
  @field jobTitle = contains(StringField);
  @field company = linksTo(Company);
  @field phones = containsMany(PhoneNumber);
  @field socialLinks = containsMany(SocialLink);

  @field fullName = contains(StringField, {
    computeVia: function(this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    }
  });

  static isolated = class extends Component<typeof Contact> {
    <template>
      <div class="contact-page">
        <header>
          <h1>{{@model.fullName}}</h1>
          <p class="title"><@fields.jobTitle /></p>
        </header>

        <section class="details">
          <div class="field">
            <label>Email</label>
            <@fields.email />
          </div>
          <div class="field">
            <label>Company</label>
            <@fields.company />
          </div>
          <div class="field">
            <label>Phone</label>
            <@fields.phones />
          </div>
          <div class="field">
            <label>Social</label>
            <@fields.socialLinks />
          </div>
        </section>
      </div>
      <style scoped>
        .contact-page {
          padding: var(--boxel-sp-lg);
          font-family: var(--boxel-font-family);
        }
        header { margin-bottom: var(--boxel-sp-lg); }
        h1 { margin: 0; font-size: 1.5rem; }
        .title { color: var(--boxel-400); margin: var(--boxel-sp-xxs) 0 0; }
        .details { display: grid; gap: var(--boxel-sp); }
        label {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-400);
          text-transform: uppercase;
        }
      </style>
    </template>
  };

  static fitted = class extends Component<typeof Contact> {
    <template>
      <div class="contact-fitted">
        <strong>{{@model.fullName}}</strong>
        <span class="meta">{{@model.jobTitle}}</span>
      </div>
      <style scoped>
        .contact-fitted {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-xs);
          height: 100%;
          justify-content: center;
        }
        .meta {
          color: var(--boxel-400);
          font-size: var(--boxel-font-size-sm);
        }
        @container fitted-card (max-height: 57px) {
          .meta { display: none; }
        }
      </style>
    </template>
  };
}
```

## Step 4: Define the Deal Card

```typescript
// deal.gts
import {
  CardDef, field, contains, linksTo, linksToMany, Component
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import { Contact } from './contact';
import { Company } from './company';

export class Deal extends CardDef {
  static displayName = 'Deal';

  @field title = contains(StringField);
  @field value = contains(NumberField);
  @field stage = contains(StringField); // "prospect", "negotiation", "closed"
  @field closeDate = contains(DateField);
  @field company = linksTo(Company);
  @field contacts = linksToMany(Contact);

  @field displayValue = contains(StringField, {
    computeVia: function(this: Deal) {
      const val = this.value ?? 0;
      return `$${val.toLocaleString()}`;
    }
  });
}
```

## Step 5: Create Instances

```json
// companies/acme.json
{
  "data": {
    "type": "card",
    "attributes": {
      "name": "Acme Corp",
      "industry": "Technology",
      "website": "https://acme.example.com"
    },
    "meta": {
      "adoptsFrom": { "module": "../company", "name": "Company" }
    }
  }
}
```

```json
// contacts/alice.json
{
  "data": {
    "type": "card",
    "attributes": {
      "firstName": "Alice",
      "lastName": "Johnson",
      "email": "alice@acme.example.com",
      "jobTitle": "VP of Engineering",
      "phones": [
        { "countryCode": "1", "number": "555-0100", "type": "work" }
      ]
    },
    "relationships": {
      "company": {
        "links": { "self": "../companies/acme" }
      }
    },
    "meta": {
      "adoptsFrom": { "module": "../contact", "name": "Contact" }
    }
  }
}
```

## Step 6: Build the CRM App Card

```typescript
// crm-app.gts
import {
  CardDef, field, linksToMany, Component
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { Contact } from './contact';
import { Company } from './company';
import { Deal } from './deal';

export class CrmApp extends CardDef {
  static displayName = 'CRM';
  static prefersWideFormat = true;

  @field contacts = linksToMany(Contact);
  @field companies = linksToMany(Company);
  @field deals = linksToMany(Deal);

  static isolated = class extends Component<typeof CrmApp> {
    @tracked activeTab = 'contacts';

    @action setTab(tab: string) {
      this.activeTab = tab;
    }

    <template>
      <div class="crm-app">
        <nav class="tabs">
          <button
            class={{if (eq this.activeTab "contacts") "active"}}
            {{on "click" (fn this.setTab "contacts")}}
          >
            Contacts
          </button>
          <button
            class={{if (eq this.activeTab "companies") "active"}}
            {{on "click" (fn this.setTab "companies")}}
          >
            Companies
          </button>
          <button
            class={{if (eq this.activeTab "deals") "active"}}
            {{on "click" (fn this.setTab "deals")}}
          >
            Deals
          </button>
        </nav>

        <main class="content">
          {{#if (eq this.activeTab "contacts")}}
            <div class="card-grid">
              <@fields.contacts />
            </div>
          {{else if (eq this.activeTab "companies")}}
            <div class="card-grid">
              <@fields.companies />
            </div>
          {{else}}
            <div class="card-grid">
              <@fields.deals />
            </div>
          {{/if}}
        </main>
      </div>
      <style scoped>
        .crm-app {
          display: grid;
          grid-template-rows: auto 1fr;
          height: 100%;
          font-family: var(--boxel-font-family);
        }
        .tabs {
          display: flex;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp);
          border-bottom: 1px solid var(--boxel-200);
        }
        .tabs button {
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          border: none;
          background: none;
          cursor: pointer;
          border-radius: var(--boxel-border-radius);
          font-size: var(--boxel-font-size);
        }
        .tabs button.active {
          background: var(--boxel-purple);
          color: white;
        }
        .content { padding: var(--boxel-sp-lg); }
        .card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: var(--boxel-sp);
        }
      </style>
    </template>
  };
}
```

## Key Patterns Used

| Pattern | Where Used |
|---------|-----------|
| **Composite fields** | PhoneNumber, SocialLink |
| **Computed fields** | Contact.fullName, Deal.displayValue |
| **linksTo** | Contact → Company |
| **linksToMany** | CrmApp → Contacts, Deals |
| **Multi-format templates** | Contact (isolated, fitted, embedded) |
| **Container queries** | Contact.fitted |
| **Tracked state** | CrmApp.activeTab |
| **Actions** | Tab switching |

## Next Steps

- [Building a Blog](/tutorials/building-a-blog) — Another tutorial
- [Patterns & Best Practices](/tutorials/patterns) — Advanced patterns
- [Defining Cards](/card-development/defining-cards) — Card reference
