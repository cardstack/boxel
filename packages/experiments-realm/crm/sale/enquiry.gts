import {
  FieldDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import NumberField from 'https://cardstack.com/base/number';

class Source extends StringField {
  // code is used for sorting order. For natural ordering
  sourceValues = [
    'Website Form',
    'Email',
    'Phone Call',
    'Live Chat',
    'Social Media',
    'Referral',
    'Advertisement',
    'Organic Search',
    'Paid Search',
    'Event Registration',
    'Webinar',
    'Direct Mail',
    'Partner',
    'Affiliate',
    'Mobile App',
    'Walk-In',
    'Support Ticket',
  ];
  @field sourceVal = contains(StringField);

  //filter of statuses only happen inside the component
}

class EnqueryType extends StringField {
  // code is used for sorting order. For natural ordering
  types = [
    'Product Inquiry',
    'Service Inquiry',
    'Support Request',
    'Quote Request',
    'Demo Request',
    'Partnership Inquiry',
    'Feedback/Suggestions',
    'Complaint',
    'Career Inquiry',
    'Newsletter Subscription',
    'Event Registration',
    'Consultation Request',
    'Referral Submission',
    'Survey Participation',
    'Donation Inquiry',
  ];
  @field type = contains(StringField);

  //filter of statuses only happen inside the component
}

export class UserEmail extends FieldDef {
  static displayName = 'User Email';
  @field email = contains(StringField, {
    description: `Email`,
  });
}
//subset of lead form
//speaks customeres language
class Enquiry extends FieldDef {
  @field name = contains(StringField);
  @field email = contains(UserEmail, {
    description: `User's Email`,
  });
  @field phone = contains(StringField, {
    description: `User's phone number`,
  });
  @field subject = contains(StringField, {
    description: `User's Company Name`,
  });
  @field enquiryType = contains(StringField, {
    description: `Method of enquiry`,
  });

  //-- everything below this is computed automatically
  @field source = contains(StringField, {
    description: ``,
  });
  @field dateOfContact = contains(DateField, {
    description: `date of enqurryy`,
  });
}

export class ProductEnquiry extends Enquiry {
  @field productId = contains(StringField, {
    description: `Product Name`,
  });
}

export class ServiceEnqiury extends Enquiry {
  @field serviceType = contains(StringField, {
    description: `Service Type`,
  });
  @field serviceDescription = contains(StringField, {
    description: `Service Description`,
  });
  @field preferredAppointmentTime = contains(DateField, {
    description: `Service Type`,
  });
}

export class SupportEnquiry extends Enquiry {
  @field issueDescription = contains(StringField, {
    description: `Issue Description`,
  });
  @field serverityLevel = contains(NumberField, {
    description: `Issue Description`,
  });
  @field id = contains(NumberField, {
    description: `product id or service id`,
  });
}

class UploadField extends FieldDef {}

export class CareerEnquiery extends Enquiry {
  @field positionOfInterest = contains(StringField, {
    description: `Issue Description`,
  });
  @field resume = contains(UploadField, {
    description: `Issue Description`,
  });
  @field cover = contains(UploadField, {
    description: `Issue Description`,
  });
}
