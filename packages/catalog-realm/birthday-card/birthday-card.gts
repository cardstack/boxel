import { on } from '@ember/modifier';
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { Button } from '@cardstack/boxel-ui/components';
import { dayjsFormat, gt, eq } from '@cardstack/boxel-ui/helpers';
import GiftIcon from '@cardstack/boxel-icons/gift';

class IsolatedBirthdayWishTemplate extends Component<typeof BirthdayWish> {
  <template>
    <div class='birthday-wish'>
      <div class='wish-content'>
        {{#if @model.message}}
          <p class='message'>{{@model.message}}</p>
        {{else}}
          <p class='message placeholder'>No message written yet...</p>
        {{/if}}
      </div>
      <div class='wish-signature'>
        <span class='from-name'>
          {{#if @model.fromName}}
            —
            {{@model.fromName}}
          {{else}}
            — Anonymous friend
          {{/if}}
        </span>
        {{#if @model.wishDate}}
          <span class='wish-date'>{{dayjsFormat @model.wishDate 'MMM D'}}</span>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .birthday-wish {
        background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%);
        border: 2px solid #f59e0b;
        border-radius: 12px;
        padding: 1rem;
        position: relative;
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);
      }

      .birthday-wish::before {
        content: '🎈';
        position: absolute;
        top: -5px;
        right: 10px;
        font-size: 1.2rem;
      }

      .message {
        font-size: 0.875rem;
        line-height: 1.4;
        color: #92400e;
        margin: 0 0 0.75rem 0;
        font-style: italic;
      }

      .message.placeholder {
        opacity: 0.6;
      }

      .wish-signature {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.75rem;
        color: #b45309;
      }

      .from-name {
        font-weight: 600;
      }
    </style>
  </template>
}

export class BirthdayWish extends FieldDef {
  static displayName = 'Birthday Wish';

  @field fromName = contains(StringField);
  @field message = contains(TextAreaField);
  @field wishDate = contains(DateField, {
    computeVia: function () {
      return new Date();
    },
  });

  static embedded = IsolatedBirthdayWishTemplate;
}

class IsolatedBirthdayCardTemplate extends Component<typeof BirthdayCard> {
  @tracked showSurprise = false;
  @tracked isAnimating = false;

  @action
  toggleSurprise() {
    this.isAnimating = true;
    this.showSurprise = !this.showSurprise;

    // Reset animation state after CSS transition completes
    requestAnimationFrame(() => {
      this.isAnimating = false;
    });
  }

  get birthdayInfo() {
    const name = this.args?.model?.recipientName ?? 'Someone Special';
    const date = this.args?.model?.birthdayDate;
    const age = this.args?.model?.age;

    let info = `Happy Birthday, ${name}! 🎉`;
    if (age) info += ` You're ${age} today!`;
    if (date) {
      info += ` Celebrated on ${new Date(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
      })}.`;
    }
    return info;
  }

  <template>
    <div class='stage'>
      <div class='birthday-card-mat'>
        <header class='card-header'>
          <div class='celebration-banner'>
            <span
              class='confetti'
              role='presentation'
              aria-hidden='true'
            >🎊</span>
            <h1 class='birthday-title'>{{this.birthdayInfo}}</h1>
            <span
              class='confetti'
              role='presentation'
              aria-hidden='true'
            >🎊</span>
          </div>
        </header>

        <section class='surprise-section'>
          <Button
            class='surprise-button {{if this.isAnimating "animating"}}'
            {{on 'click' this.toggleSurprise}}
            aria-expanded={{this.showSurprise}}
            aria-controls='surprise-message'
          >
            <svg
              class='gift-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
              aria-hidden='true'
              role='presentation'
            >
              <polyline points='20,12 20,22 4,22 4,12' />
              <rect x='2' y='7' width='20' height='5' />
              <line x1='12' y1='22' x2='12' y2='7' />
              <path
                d='m12,7-3-3a1,1 0 0,1 0,-1.41l0,0a1,1 0 0,1 1.41,0L12,4.59l1.59-1.59a1,1 0 0,1 1.41,0l0,0a1,1 0 0,1 0,1.41L12,7Z'
              />
            </svg>
            {{if this.showSurprise 'Hide Surprise' 'Click for Surprise!'}}
          </Button>

          {{#if this.showSurprise}}
            <div
              id='surprise-message'
              class='surprise-message'
              role='region'
              aria-label='Surprise message'
            >
              {{#if @model.surpriseMessage}}
                <p>{{@model.surpriseMessage}}</p>
              {{else}}
                <p>🌟 May this year bring you joy, laughter, and all your dreams
                  come true! 🌟</p>
              {{/if}}
            </div>
          {{/if}}
        </section>

        <section class='wishes-section'>
          <h3 class='section-title'>
            <svg
              class='section-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
              aria-hidden='true'
              role='presentation'
            >
              <path
                d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'
              />
            </svg>
            Birthday Wishes
          </h3>

          {{#if (gt @model.wishes.length 0)}}
            <div class='wishes-container'>
              <@fields.wishes @format='embedded' />
            </div>
          {{else}}
            <div class='empty-wishes'>
              <p>No birthday wishes yet! Be the first to write one! 💝</p>
            </div>
          {{/if}}
        </section>

        <div class='decorations' role='presentation' aria-hidden='true'>
          <div class='balloon balloon-1'>🎈</div>
          <div class='balloon balloon-2'>🎈</div>
          <div class='balloon balloon-3'>🎈</div>
          <div class='cake-decoration'>🎂</div>
        </div>
      </div>
    </div>

    <style scoped>
      .stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 1rem;
        background: linear-gradient(
          135deg,
          #fef3c7 0%,
          #fed7aa 50%,
          #fecaca 100%
        );
        position: relative;
        overflow: hidden;
      }

      @media (max-width: 800px) {
        .stage {
          padding: 0.5rem;
        }
      }

      .birthday-card-mat {
        max-width: 48rem;
        width: 100%;
        background: white;
        border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        overflow-y: auto;
        max-height: 100%;
        position: relative;
      }

      .card-header {
        background: linear-gradient(
          135deg,
          #f59e0b 0%,
          #dc2626 50%,
          #e11d48 100%
        );
        color: white;
        padding: 2rem;
        text-align: center;
        border-radius: 16px 16px 0 0;
      }

      .celebration-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
      }

      .confetti {
        font-size: 2rem;
        animation: bounce 2s infinite;
      }

      .birthday-title {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      @media (max-width: 600px) {
        .birthday-title {
          font-size: 1.125rem;
        }
        .confetti {
          font-size: 1.5rem;
        }
      }

      .surprise-section {
        padding: 2rem;
        text-align: center;
        border-bottom: 2px solid #fef3c7;
      }

      .surprise-button {
        background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
        color: white;
        border: none;
        border-radius: 25px;
        padding: 0.75rem 1.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
      }

      .surprise-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(139, 92, 246, 0.4);
      }

      .surprise-button.animating {
        transform: scale(0.95);
      }

      .gift-icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .surprise-message {
        margin-top: 1.5rem;
        padding: 1.5rem;
        background: linear-gradient(135deg, #ddd6fe 0%, #fce7f3 100%);
        border-radius: 12px;
        border: 2px solid #c084fc;
        animation: fadeIn 0.5s ease;
      }

      .surprise-message p {
        margin: 0;
        font-size: 1rem;
        font-weight: 500;
        color: #7c3aed;
        text-align: center;
      }

      .wishes-section {
        padding: 2rem;
      }

      .section-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: #dc2626;
        margin: 0 0 1.5rem 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .section-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: #dc2626;
      }

      .wishes-container > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .empty-wishes {
        text-align: center;
        padding: 2rem;
        color: #6b7280;
        font-style: italic;
      }

      .empty-wishes p {
        margin: 0;
        font-size: 0.875rem;
      }

      .decorations {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
      }

      .balloon {
        position: absolute;
        font-size: 2rem;
        animation: float 3s ease-in-out infinite;
      }

      .balloon-1 {
        top: 20%;
        left: 10%;
        animation-delay: 0s;
      }

      .balloon-2 {
        top: 30%;
        right: 15%;
        animation-delay: 1s;
      }

      .balloon-3 {
        top: 60%;
        left: 5%;
        animation-delay: 2s;
      }

      .cake-decoration {
        position: absolute;
        bottom: 20px;
        right: 20px;
        font-size: 3rem;
        animation: spin 10s linear infinite;
      }

      @keyframes bounce {
        0%,
        20%,
        50%,
        80%,
        100% {
          transform: translateY(0);
        }
        40% {
          transform: translateY(-10px);
        }
        60% {
          transform: translateY(-5px);
        }
      }

      @keyframes float {
        0%,
        100% {
          transform: translateY(0px);
        }
        50% {
          transform: translateY(-20px);
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .card-header,
      .surprise-section,
      .wishes-section {
        position: relative;
        z-index: 2;
      }
    </style>
  </template>
}

class EmbeddedBirthdayCardTemplate extends Component<typeof BirthdayCard> {
  <template>
    <div class='birthday-card-compact'>
      <div class='compact-header'>
        <span
          class='birthday-emoji'
          role='presentation'
          aria-hidden='true'
        >🎂</span>
        <div class='compact-info'>
          <h4>{{if
              @model.recipientName
              @model.recipientName
              'Birthday Celebration'
            }}</h4>
          {{#if @model.age}}
            <span class='age-badge'>{{@model.age}} years old!</span>
          {{/if}}
        </div>
      </div>

      {{#if (gt @model.wishes.length 0)}}
        <div class='compact-wishes'>
          <span class='wishes-count'>{{@model.wishes.length}}
            birthday wish{{unless (eq @model.wishes.length 1) 'es'}}</span>
        </div>
      {{else}}
        <div class='compact-wishes'>
          <span class='wishes-count'>No wishes yet</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .birthday-card-compact {
        background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%);
        border: 2px solid #f59e0b;
        border-radius: 12px;
        padding: 1rem;
        font-size: 0.8125rem;
      }

      .compact-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }

      .birthday-emoji {
        font-size: 1.5rem;
      }

      .compact-info h4 {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: #92400e;
      }

      .age-badge {
        background: #f59e0b;
        color: white;
        padding: 0.125rem 0.375rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 500;
      }

      .wishes-count {
        font-size: 0.75rem;
        color: #b45309;
        font-style: italic;
      }
    </style>
  </template>
}

export class BirthdayCard extends CardDef {
  static displayName = 'Birthday Card';
  static icon = GiftIcon;

  @field recipientName = contains(StringField);
  @field birthdayDate = contains(DateField);
  @field age = contains(NumberField);
  @field wishes = containsMany(BirthdayWish);
  @field surpriseMessage = contains(TextAreaField);

  @field title = contains(StringField, {
    computeVia: function (this: BirthdayCard) {
      const name = this.recipientName ?? 'Someone Special';
      const age = this.age ? ` (${this.age})` : '';
      return `🎂 ${name}'s Birthday${age}`;
    },
  });

  static isolated = IsolatedBirthdayCardTemplate;
  static embedded = EmbeddedBirthdayCardTemplate;
}
