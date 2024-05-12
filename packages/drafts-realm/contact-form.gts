import { UserName } from './user-name';
import { UserEmail } from './user-email';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import {
  FieldContainer,
  CardContainer,
  IconButton,
} from '@cardstack/boxel-ui/components';
import { Sparkle } from '@cardstack/boxel-ui/icons';
import { tracked } from '@glimmer/tracking';

class Isolated extends Component<typeof ContactForm> {
  @tracked hasTitleField =
    this.args.model.title && this.args.model.title.length > 0;

  <template>
    <div class='decorative-header'></div>

    <CardContainer @displayBoundaries={{false}} class='card-container'>
      {{#if this.hasTitleField}}
        <h2><@fields.title /></h2>
      {{/if}}

      <div class='card-form-display'>
        <IconButton
          @icon={{Sparkle}}
          @width='22px'
          @height='22px'
          @variant='undefined'
          class='icon-profile'
          aria-label='Profile'
        />

        <div class='contact-form-details'>
          <div class='field-input'>
            <label>Full Name: </label>
            <@fields.name />
          </div>

          <div class='field-input'>
            <label>Email: </label>
            <@fields.email />
          </div>

          <div class='field-input'>
            <label>Phone: </label>
            <@fields.phone />
          </div>

          <div class='field-input'>
            <label>Fax: </label>
            <@fields.fax />
          </div>

          <div class='field-input'>
            <label>Department: </label>
            <@fields.department />
          </div>
        </div>
      </div>

    </CardContainer>

    <style>
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Ubuntu+Sans:ital,wght@0,100..800;1,100..800&display=swap');
      h2 {
        font-family: 'Playfair Display', serif;
        font-optical-sizing: auto;
        font-size: 2.2rem;
        margin: 0;
      }
      .card-container {
        width: 100%;
        padding: 1rem;
        display: grid;
        margin: auto;
        gap: var(--boxel-sp-lg);
      }

      .card-form-display {
        position: relative;
      }

      .icon-profile {
        position: absolute;
        top: 1px;
        right: 1px;
        width: 50px;
        height: 50px;
      }

      .contact-form-details {
        width: 100%;
        padding: 3rem 2rem;
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius-xl);
        background-color: #eeeeee50;
        display: grid;
        gap: var(--boxel-sp-lg);
        justify-content: center;
        text-align: center;
      }

      .field-input {
        display: flex;
        gap: var(--boxel-sp-xxl);
        font-size: 1rem;
        flex-wrap: wrap;
        min-width: 280px;
      }

      .field-input > label {
        font-weight: 700;
      }

      .decorative-header {
        background-image: url(https://i.imgur.com/PQuDAEo.jpg);
        height: var(--boxel-sp-xl);
        grid-column: 1 / span 2;
        margin-bottom: var(--boxel-sp);
      }
      h2 {
        margin-block-start: 0px;
        margin-block-end: 0px;
        margin: 0px;
        text-align: center;
      }

      @media (min-width: 768px) {
        .contact-form-details {
          gap: var(--boxel-sp-xl);
        }
        .field-input {
          gap: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

class View extends Component<typeof ContactForm> {
  <template>
    <CardContainer @displayBoundaries={{true}} class='card-container'>
      <IconButton
        @icon={{Sparkle}}
        @width='22px'
        @height='22px'
        @variant='undefined'
        class='icon-profile'
        aria-label='Profile'
      />
      <div class='content'>
        <label>User</label>
        <h2><@fields.name /></h2>
      </div>
    </CardContainer>

    <style>
      .card-container {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp);
        background-color: #eeeeee50;
      }
      .content {
        color: var(--boxel-700);
      }
      h2 {
        margin: 0px;
      }
      .icon-profile {
        position: absolute;
        top: 1px;
        right: 1px;
        width: 50px;
        height: 50px;
      }
    </style>
  </template>
}

class Edit extends Component<typeof ContactForm> {
  <template>
    <CardContainer @displayBoundaries={{true}} class='card-container'>
      <FieldContainer
        @tag='label'
        @label='Title'
        @vertical={{true}}
      ><@fields.title /></FieldContainer>

      <FieldContainer @tag='label' @label='User' @vertical={{true}}>
        <@fields.name />
      </FieldContainer>

      <@fields.email />

      <FieldContainer @tag='label' @label='Phone' @vertical={{true}}>
        <@fields.phone />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Fax' @vertical={{true}}><@fields.fax
        /></FieldContainer>

      <FieldContainer
        @tag='label'
        @label='Department'
        @vertical={{true}}
      ><@fields.department /></FieldContainer>
    </CardContainer>

    <style>
      .card-container {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

export class ContactForm extends CardDef {
  @field title = contains(StringField, {
    description: `Contact Form Title`,
  });
  @field name = contains(UserName, {
    description: `User's Full Name`,
  });
  @field email = contains(UserEmail, {
    description: `User's Email`,
  });
  @field phone = contains(StringField, {
    description: `User's phone number`,
  });

  @field fax = contains(StringField, {
    description: `User's Fax Number`,
  });
  @field department = contains(StringField, {
    description: `User's Department`,
  });

  static displayName = 'Contact Form';
  static isolated = Isolated;
  static embedded = View;
  static atom = View;
  static edit = Edit;
}
