// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import { and } from '@cardstack/boxel-ui/helpers'; // ² Helpers

// Configuration interface
interface AgeConfiguration {
  ageOptions?: {
    showNextBirthday?: boolean;
  };
}

// ³ Age Component
export class Age extends Component {
  get config(): AgeConfiguration | undefined {
    return this.args.config as AgeConfiguration | undefined;
  }

  get birthDate() {
    return this.args.model?.value ?? this.args.model;
  }

  get showNextBirthday() {
    return this.config?.ageOptions?.showNextBirthday ?? true;
  }

  get age() {
    if (!this.birthDate) return null;

    try {
      const birth = new Date(this.birthDate);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birth.getDate())
      ) {
        age--;
      }

      return age;
    } catch {
      return null;
    }
  }

  get nextBirthday() {
    if (!this.birthDate) return null;

    try {
      const birth = new Date(this.birthDate);
      const today = new Date();
      const nextBday = new Date(
        today.getFullYear(),
        birth.getMonth(),
        birth.getDate(),
      );

      if (nextBday < today) {
        nextBday.setFullYear(today.getFullYear() + 1);
      }

      const diff = nextBday.getTime() - today.getTime();
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

      return days;
    } catch {
      return null;
    }
  }

  get birthDateDisplay() {
    if (!this.birthDate) return '';

    try {
      return new Date(this.birthDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  <template>
    <div class='age-calculator' data-test-age-calculator>
      {{#if this.age}}
        <div class='age-display'>
          <div class='age-value'>{{this.age}} years old</div>
          <div class='age-meta'>
            Born
            {{this.birthDateDisplay}}
            {{#if (and this.nextBirthday this.showNextBirthday)}}
              • Next birthday in
              {{this.nextBirthday}}
              days
            {{/if}}
          </div>
        </div>
      {{else}}
        <div class='age-placeholder'>No birth date set</div>
      {{/if}}
    </div>

    <style scoped>
      .age-calculator {
        padding: 0.75rem;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.1),
          rgba(147, 197, 253, 0.1)
        );
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: var(--radius, 0.375rem);
      }

      .age-display {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .age-value {
        font-size: 1.125rem;
        font-weight: 700;
        color: var(--primary, #3b82f6);
      }

      .age-meta {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .age-placeholder {
        font-size: 0.875rem;
        color: var(--muted-foreground, #9ca3af);
        font-style: italic;
      }
    </style>
  </template>
}
