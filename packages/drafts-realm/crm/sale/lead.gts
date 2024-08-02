import {
  CardDef,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';

class CountryCode extends CardDef {}
class Country extends CardDef {}
class Company extends CardDef {}
class MonetaryAmount extends FieldDef {}
class RangeCurrencyAmount extends FieldDef {}

export class AddressInfo extends FieldDef {
  static displayName = 'Mailing Address';
  @field address = contains(StringField, {
    description: `Mailing Address`,
  });
  @field zip = contains(StringField, {
    description: `Mailing Zip/Postal Code`,
  });
  @field city = contains(StringField, {
    description: `Mailing City`,
  });
  @field state = contains(StringField, {
    description: `Mailing State/Province`,
  });
  @field country = linksTo(Country, {
    description: `Mailing Country`,
  });
  @field countryCode = linksTo(CountryCode, {
    description: `Mailing Country Code`,
  });
  @field stateCode = contains(StringField, {
    description: `Mailing State Code`,
  });
}

export class UserEmail extends FieldDef {
  static displayName = 'User Email';
  @field email = contains(StringField, {
    description: `Email`,
  });
}

//Picklist Loosey Goosey
class LeadStatus extends StringField {
  // code is used for sorting order. For natural ordering
  statuses = [
    { code: 1, displayName: 'New' },
    { code: 2, displayName: 'Contacted' },
    { code: 3, displayName: 'Qualified' },
    { code: 4, displayName: 'Unqualified' },
    { code: 5, displayName: 'Nurturing' },
    { code: 6, displayName: 'Proposal Sent' },
    { code: 7, displayName: 'Negotiation' },
    { code: 8, displayName: 'Closed - Won' },
    { code: 9, displayName: 'Closed - Lost' },
    { code: 10, displayName: 'No Response' },
  ];
  @field displayName = contains(StringField);

  //filter of statuses only happen inside the component
}

export class UserName extends FieldDef {
  static displayName = 'User Name';
  @field salutation = contains(StringField, {
    description: `User's Salutation`,
  });
  @field firstName = contains(StringField, {
    description: `User's First Name`,
  });
  @field lastName = contains(StringField, {
    description: `User's Last Name`,
  });
}

export class LeadForm extends CardDef {
  static displayName = 'Lead Form';
  @field title = contains(StringField, {
    computeVia: function (this: LeadForm) {
      const { salutation, firstName, lastName } = this.user;

      if (!salutation || !firstName || !lastName) return 'User Not Found';
      return `${salutation} ${firstName} ${lastName}`;
    },
  });
  @field name = contains(StringField);
  @field company = linksTo(Company, {
    description: `User's Company Name`,
  });
  @field website = contains(StringField, {
    description: `User's Website`,
  });
  @field leadStatus = contains(LeadStatus, {
    description: `Lead Status`,
  });
  @field phone = contains(StringField, {
    description: `User's phone number`,
  });
  @field email = contains(UserEmail, {
    description: `User's Email`,
  });
  @field addressInfo = contains(AddressInfo, {
    description: `User's AddressInfo`,
  });
  @field annualRevenue = contains(MonetaryAmount, {
    description: `Annual Revenue`,
  });
  @field noOfEmployees = contains(NumberField, {
    description: `No Of Employees`,
  });
  @field leadSource = contains(StringField, {
    description: `Lead Source`,
  });
  @field industry = contains(StringField, {
    description: `Industry`,
  });
}
