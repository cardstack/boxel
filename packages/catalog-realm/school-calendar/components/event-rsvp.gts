import { gt } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import EmailField from 'https://cardstack.com/base/email';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { Button } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import CheckCircleIcon from '@cardstack/boxel-icons/circle-check';

export class AttendeeField extends FieldDef {
  static displayName = 'Attendee';

  @field name = contains(StringField);
  @field email = contains(EmailField);
  @field isAttending = contains(BooleanField);
  @field guestCount = contains(NumberField);
  @field dietaryRestrictions = contains(TextAreaField);
}

class EventRvspIsolatedTemplate extends Component<typeof EventRsvp> {
  @tracked showSuccessMessage = false;
  @tracked newAttendee = {
    name: '',
    email: '',
    isAttending: true,
    guestCount: 0,
    dietaryRestrictions: '',
  };

  @action
  updateName(event: Event) {
    let value = (event.target as HTMLInputElement).value;
    this.newAttendee.name = value;
    return value;
  }

  @action
  updateEmail(event: Event) {
    let value = (event.target as HTMLInputElement).value;
    this.newAttendee.email = value;
    return value;
  }

  @action
  updateGuestCount(event: Event) {
    let value = parseInt((event.target as HTMLInputElement).value) || 0;
    this.newAttendee.guestCount = value;
    return value;
  }

  @action
  updateDietaryRestrictions(event: Event) {
    let value = (event.target as HTMLTextAreaElement).value;
    this.newAttendee.dietaryRestrictions = value;
    return value;
  }

  @action
  submitRsvp() {
    if (this.newAttendee.name && this.newAttendee.email) {
      // Add the new attendee to the model's attendees array
      if (Array.isArray(this.args.model.attendees)) {
        this.args.model.attendees = [
          ...this.args.model.attendees,
          new AttendeeField({ ...this.newAttendee }),
        ];
      }

      this.showSuccessMessage = true;

      // Reset the form
      setTimeout(() => {
        this.showSuccessMessage = false;
        this.newAttendee = {
          name: '',
          email: '',
          isAttending: true,
          guestCount: 0,
          dietaryRestrictions: '',
        };
      }, 3000);
    }
  }

  <template>
    <div class='rsvp-container'>
      <div class='rsvp-header'>
        <h1>RSVP Form</h1>
        {{#if @model.deadline}}
          <p class='rsvp-deadline'>Please respond by {{@model.deadline}}</p>
        {{/if}}
      </div>

      <div class='rsvp-form'>
        {{#if this.showSuccessMessage}}
          <div class='success-message'>
            <CheckCircleIcon width='48' height='48' />
            <h2>Thank you for your RSVP!</h2>
            <p>Your response has been recorded.</p>
          </div>
        {{else}}
          <div class='form-group'>
            <label for='rsvp-name'>Your Name<span
                class='required-asterisk'
              >*</span></label>
            <input
              id='rsvp-name'
              type='text'
              placeholder='Enter your full name'
              value={{this.newAttendee.name}}
              required
              {{on 'input' this.updateName}}
            />
          </div>

          <div class='form-group'>
            <label for='rsvp-email'>Email Address<span
                class='required-asterisk'
              >*</span></label>
            <input
              id='rsvp-email'
              type='email'
              placeholder='Enter your email address'
              value={{this.newAttendee.email}}
              required
              {{on 'input' this.updateEmail}}
            />
          </div>

          <div class='form-group'>
            <label for='rsvp-guests'>Number of Guests</label>
            <input
              id='rsvp-guests'
              type='number'
              min='0'
              max='10'
              value={{this.newAttendee.guestCount}}
              {{on 'input' this.updateGuestCount}}
            />
            <div class='field-hint'>Not including yourself</div>
          </div>

          <div class='form-group'>
            <label for='rsvp-dietary'>Dietary Restrictions or Notes</label>
            <textarea
              id='rsvp-dietary'
              placeholder='Please let us know of any dietary restrictions or special needs'
              value={{this.newAttendee.dietaryRestrictions}}
              {{on 'input' this.updateDietaryRestrictions}}
            ></textarea>
          </div>

          <div class='submit-section'>
            <Button @kind='primary' {{on 'click' this.submitRsvp}}>Submit RSVP</Button>
          </div>
        {{/if}}
      </div>

      {{#if (gt @model.attendees.length 0)}}
        <div class='attendees-list'>
          <h2>Current Attendees ({{@model.attendees.length}})</h2>
          <div class='attendee-grid'>
            {{#each @model.attendees as |attendee|}}
              <div class='attendee-card'>
                <div class='attendee-name'>{{attendee.name}}</div>
                <div class='attendee-details'>
                  {{#if (gt attendee.guestCount 0)}}
                    <div class='guest-count'>+{{attendee.guestCount}}
                      guests</div>
                  {{/if}}
                </div>
              </div>
            {{/each}}
          </div>
        </div>
      {{/if}}

    </div>
    <style scoped>
      .rsvp-container {
        font-family:
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        max-width: 800px;
        margin: 0 auto;
      }
      .rsvp-header {
        text-align: center;
        margin-bottom: 32px;
      }
      h1 {
        font-size: 28px;
        color: #2c3e50;
        margin-bottom: 8px;
      }
      .rsvp-deadline {
        color: #e74c3c;
        font-weight: 500;
      }
      .rsvp-form {
        background-color: white;
        padding: 24px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        margin-bottom: 32px;
      }
      .form-group {
        margin-bottom: 20px;
        display: flex;
        flex-direction: column;
      }
      .form-group label {
        font-weight: 500;
        margin-bottom: 8px;
        color: #34495e;
        font-size: 16px;
      }
      .form-group input,
      .form-group textarea {
        padding: 12px 14px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 16px;
        background: #f8fafc;
        transition:
          border-color 0.2s,
          box-shadow 0.2s;
        outline: none;
        box-shadow: 0 1px 2px rgba(44, 62, 80, 0.03);
        margin-bottom: 2px;
      }
      .form-group input:focus,
      .form-group textarea:focus {
        border-color: #3498db;
        background: #fff;
        box-shadow: 0 0 0 2px #eaf6fb;
      }
      .form-group textarea {
        min-height: 90px;
        resize: vertical;
      }
      .form-group input[type='number']::-webkit-inner-spin-button,
      .form-group input[type='number']::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      .form-group input[type='number'] {
        appearance: textfield;
      }
      .text-input,
      .number-input,
      .text-area {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 16px;
        transition: border-color 0.2s;
      }
      .text-input:focus,
      .number-input:focus,
      .text-area:focus {
        border-color: #3498db;
        outline: none;
      }
      .text-area {
        min-height: 100px;
        resize: vertical;
      }
      .field-hint {
        font-size: 14px;
        color: #7f8c8d;
        margin-top: 4px;
      }
      .submit-section {
        margin-top: 24px;
        text-align: center;
      }
      .success-message {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
        color: #27ae60;
      }
      .success-message h2 {
        margin: 16px 0 8px 0;
      }
      .success-message p {
        color: #2c3e50;
        margin: 0;
      }
      .attendees-list {
        background-color: white;
        padding: 24px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      .attendees-list h2 {
        font-size: 20px;
        margin-bottom: 16px;
        color: #2c3e50;
      }
      .attendee-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 16px;
      }
      .attendee-card {
        border: 1px solid #eaeaea;
        border-radius: 4px;
        padding: 12px;
        background-color: #f9f9f9;
      }
      .attendee-name {
        font-weight: 500;
        margin-bottom: 4px;
      }
      .attendee-details {
        font-size: 14px;
        color: #7f8c8d;
      }
      .required-asterisk {
        color: #e74c3c;
      }
    </style>
  </template>
}

class EventRvspEmbeddedTemplate extends Component<typeof EventRsvp> {
  <template>
    <div class='rsvp-embedded'>
      <h3>RSVP for this Event</h3>
      {{#if @model.deadline}}
        <p class='deadline'>Please respond by {{@model.deadline}}</p>
      {{/if}}
      <div class='rsvp-stats'>
        <div class='stat'>
          <div class='stat-value'>{{@model.attendees.length}}</div>
          <div class='stat-label'>Responses</div>
        </div>
        <div class='stat'>
          <div class='stat-value'>{{@model.maxAttendees}}</div>
          <div class='stat-label'>Max Capacity</div>
        </div>
      </div>
      <div class='rsvp-cta'>
        <Button @kind='primary'>Respond Now</Button>
      </div>
    </div>
    <style scoped>
      .rsvp-embedded {
        padding: 16px;
        background-color: #f8f9fa;
        border-radius: 8px;
        border: 1px solid #e9ecef;
      }
      h3 {
        margin: 0 0 8px 0;
        font-size: 18px;
        color: #2c3e50;
      }
      .deadline {
        color: #e74c3c;
        font-size: 14px;
        margin-bottom: 16px;
      }
      .rsvp-stats {
        display: flex;
        justify-content: space-around;
        margin-bottom: 16px;
      }
      .stat {
        text-align: center;
      }
      .stat-value {
        font-size: 24px;
        font-weight: bold;
        color: #3498db;
      }
      .stat-label {
        font-size: 14px;
        color: #7f8c8d;
      }
      .rsvp-cta {
        text-align: center;
      }
    </style>
  </template>
}

export class EventRsvp extends CardDef {
  static displayName = 'Event RSVP';
  static icon = CheckCircleIcon;

  @field deadline = contains(StringField);
  @field maxAttendees = contains(NumberField);
  @field requiresApproval = contains(BooleanField);
  @field attendees = containsMany(AttendeeField);

  static isolated = EventRvspIsolatedTemplate;
  static embedded = EventRvspEmbeddedTemplate;
}
