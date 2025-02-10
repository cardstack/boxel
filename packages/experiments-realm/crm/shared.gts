import {
  CardDef,
  linksTo,
  contains,
  containsMany,
  field,
  linksToMany,
  StringField,
} from 'https://cardstack.com/base/card-api';

// Fields
import { StatusTagField } from './contact-status-tag';
import { WebsiteField } from '../website';
import { UrgencyTag } from './urgency-tag';
import { ContactPhoneNumber } from '../phone-number';
import { EmailField } from '../email';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import { PercentageField } from '../percentage';
import MarkdownField from 'https://cardstack.com/base/markdown';
import BooleanField from 'https://cardstack.com/base/boolean';
import { AmountWithCurrency as AmountWithCurrencyField } from '../fields/amount-with-currency';
import { Address as AddressField } from '../address';

// Icons
import ContactIcon from '@cardstack/boxel-icons/contact';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import PresentationAnalytics from '@cardstack/boxel-icons/presentation-analytics';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';

// Components
import {
  IsolatedTemplate as AccountIsolatedTemplate,
  EmbeddedTemplate as AccountEmbeddedTemplate,
  FittedTemplate as AccountFittedTemplate,
} from './account';
import { CrmAppTemplate } from '../crm-app';
import {
  EmbeddedTemplate as ContactEmbeddedTemplate,
  FittedTemplate as ContactFittedTemplate,
  AtomTemplate as ContactAtomTemplate,
  SocialLinkField,
} from './contact';
import { ViewCompanyTemplate } from './company';
import {
  IsolatedTemplate as DealIsolatedTemplate,
  FittedTemplate as DealFittedTemplate,
  ValueLineItem,
} from './deal';
import { DealEvent } from './deal-event';
import { DealStatus } from './deal-status';
import { DealPriority } from './deal-priority';

export class CrmApp extends CardDef {
  static displayName = 'CRM App';
  static prefersWideFormat = true;
  static headerColor = '#4D3FE8';
  static isolated = CrmAppTemplate;
}

export class Company extends CardDef {
  static displayName = 'Company';

  @field crmApp = linksTo(() => CrmApp);
  @field name = contains(StringField);
  @field industry = contains(StringField);
  @field headquartersAddress = contains(AddressField);
  @field phone = contains(NumberField);
  @field website = contains(WebsiteField);
  @field stockSymbol = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Company) {
      return this.name;
    },
  });

  static embedded = ViewCompanyTemplate;
  static atom = ViewCompanyTemplate;
}

export class Contact extends CardDef {
  static displayName = 'CRM Contact';
  static icon = ContactIcon;

  @field crmApp = linksTo(() => CrmApp);
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field position = contains(StringField);
  @field company = linksTo(() => Company);
  @field department = contains(StringField);
  @field primaryEmail = contains(EmailField);
  @field secondaryEmail = contains(EmailField);
  @field phoneMobile = contains(ContactPhoneNumber);
  @field phoneOffice = contains(ContactPhoneNumber);
  @field socialLinks = containsMany(SocialLinkField);
  @field statusTag = contains(StatusTagField); //this is an empty field that gets computed in subclasses

  @field name = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.name;
    },
  });

  @field email = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.primaryEmail ?? this.secondaryEmail;
    },
  });

  static embedded = ContactEmbeddedTemplate;
  static fitted = ContactFittedTemplate;
  static atom = ContactAtomTemplate;
}

export class Account extends CardDef {
  static displayName = 'CRM Account';

  @field crmApp = linksTo(() => CrmApp);
  @field company = linksTo(() => Company);
  @field primaryContact = linksTo(() => Contact);
  @field contacts = linksToMany(() => Contact);
  @field shippingAddress = contains(AddressField);
  @field billingAddress = contains(AddressField);
  @field urgencyTag = contains(UrgencyTag);

  @field name = contains(StringField, {
    computeVia: function (this: Account) {
      return this.company?.name;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field headquartersAddress = contains(AddressField, {
    computeVia: function (this: Account) {
      return this.company?.headquartersAddress;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field website = contains(WebsiteField, {
    computeVia: function (this: Account) {
      return this.company?.website;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Account) {
      return this.primaryContact?.statusTag;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: Account) {
      return this.company?.name;
    },
  });

  static isolated = AccountIsolatedTemplate;
  static embedded = AccountEmbeddedTemplate;
  static fitted = AccountFittedTemplate;
}

export class Customer extends Contact {
  static displayName = 'CRM Customer';
  static icon = HeartHandshakeIcon;
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Customer) {
      return new StatusTagField({
        label: 'Customer',
        lightColor: '#8bff98',
        darkColor: '#01d818',
      });
    },
  });
}

export class Representative extends Contact {
  static displayName = 'CRM Representative';
  static icon = PresentationAnalytics;
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Representative) {
      return new StatusTagField({
        label: 'Representative',
        lightColor: '#7FDBDA',
        darkColor: '#07BABA',
      });
    },
  });
}

export class Lead extends Contact {
  static displayName = 'CRM Lead';
  static icon = TargetArrowIcon;
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Lead) {
      return new StatusTagField({
        label: 'Lead',
        lightColor: '#E6F4FF',
        darkColor: '#0090FF',
      });
    },
  });
}

export class Deal extends CardDef {
  static displayName = 'CRM Deal';
  static headerColor = '#f8f7fa';
  @field crmApp = linksTo(() => CrmApp);
  @field name = contains(StringField);
  @field account = linksTo(() => Account);
  @field status = contains(DealStatus);
  @field priority = contains(DealPriority);
  @field closeDate = contains(DateField);
  @field currentValue = contains(AmountWithCurrencyField);
  @field computedValue = contains(AmountWithCurrencyField, {
    computeVia: function (this: Deal) {
      let total =
        this.currentValue?.amount ??
        this.valueBreakdown?.reduce((acc, item) => {
          return acc + item.value.amount;
        }, 0);
      let result = new AmountWithCurrencyField();
      result.amount = total;
      result.currency = this.currentValue?.currency;
      return result;
    },
  });
  @field predictedRevenue = contains(AmountWithCurrencyField);
  @field profitMargin = contains(PercentageField, {
    computeVia: function (this: Deal) {
      if (!this.currentValue?.amount || !this.predictedRevenue?.amount) {
        return null;
      }
      return (this.currentValue?.amount / this.predictedRevenue?.amount) * 100;
    },
  });
  @field healthScore = contains(PercentageField);
  @field event = linksTo(() => DealEvent);
  @field notes = contains(MarkdownField);
  @field primaryStakeholder = linksTo(() => Contact);
  @field stakeholders = linksToMany(() => Contact);
  @field valueBreakdown = containsMany(ValueLineItem);
  @field isActive = contains(BooleanField, {
    computeVia: function (this: Deal) {
      return (
        this.status.label !== 'Closed Won' &&
        this.status.label !== 'Closed Lost'
      );
    },
    isUsed: true,
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field headquartersAddress = contains(AddressField, {
    computeVia: function (this: Deal) {
      return this.account?.headquartersAddress;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field website = contains(WebsiteField, {
    computeVia: function (this: Deal) {
      return this.account?.website;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field primaryContact = linksTo(() => Contact, {
    computeVia: function (this: Deal) {
      return this.account?.primaryContact;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field company = linksTo(() => Company, {
    computeVia: function (this: Deal) {
      return this.account?.company;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: Deal) {
      return this.name;
    },
  });

  static isolated = DealIsolatedTemplate;
  static fitted = DealFittedTemplate;
}
