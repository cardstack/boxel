import { ModelConfiguration } from './model-configuration'; // ¹ Import base
import { field, contains, linksTo } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import enumField from 'https://cardstack.com/base/enum'; // ² Import enum field

const PurposeField = enumField(StringField, {
  options: [
    { value: '', label: '(No specific purpose)' },
    { value: 'code', label: 'Code' },
    { value: 'design', label: 'Design' },
    { value: 'debug', label: 'Debug' },
    { value: 'chat', label: 'Chat' },
  ],
});

const ThinkingEffortField = enumField(StringField, {
  options: [
    { value: 'none', label: 'None' },
    { value: 'minimal', label: 'Minimal (10% tokens)' },
    { value: 'low', label: 'Low (20% tokens)' },
    { value: 'medium', label: 'Medium (50% tokens)' },
    { value: 'high', label: 'High (80% tokens)' },
  ],
});

export class RecommendedModel extends ModelConfiguration {
  static displayName = 'Recommended Model';

  @field purpose = contains(PurposeField);

  @field modelConfiguration = linksTo(() => ModelConfiguration);

  @field thinkingEffort = contains(ThinkingEffortField);

  @field reasoningEffort = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      // If none or not set, return empty string
      if (!this.thinkingEffort || this.thinkingEffort === 'none') {
        return '';
      }
      // Otherwise return the effort level
      return this.thinkingEffort;
    },
  });

  @field canonicalSlug = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      try {
        return this.modelConfiguration?.canonicalSlug ?? null;
      } catch (e) {
        return null;
      }
    },
  });

  @field modelId = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      try {
        return this.modelConfiguration?.modelId ?? null;
      } catch (e) {
        return null;
      }
    },
  });

  @field name = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      try {
        return this.modelConfiguration?.name ?? null;
      } catch (e) {
        return null;
      }
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      // Get the full model name (e.g., "OpenAI: GPT-5.1 Chat" or "Google: Gemini 2.5 Flash")
      let fullModelName = '';
      let modelName = '';

      try {
        fullModelName = this.modelConfiguration?.name ?? '';
        if (fullModelName) {
          const parts = fullModelName.split(':');
          if (parts.length > 1) {
            modelName = parts[1].trim();
          } else {
            modelName = fullModelName.trim();
          }
        }
      } catch (e) {
        fullModelName = '';
      }

      // Build purpose segment with emoji (e.g., "🎨 Design" or "💬 Chat")
      let purposeSegment = '';
      const hasRoleSpecificPurpose = this.purpose && this.purpose !== '';

      if (hasRoleSpecificPurpose) {
        const purposeEmojis: Record<string, string> = {
          code: '💻',
          design: '🎨',
          debug: '🔧',
          chat: '💬',
        };
        const emoji = purposeEmojis[this.purpose] || '💬';
        const purposeLabel =
          this.purpose.charAt(0).toUpperCase() + this.purpose.slice(1);
        purposeSegment = `${emoji} ${purposeLabel}・`;
      }

      // Build model segment
      // For role-specific: skip brand, just use model name (e.g., "Gemini 3 Pro Preview")
      // For non-role-specific: add checkmark prefix and use full name (e.g., "✓ OpenAI: GPT-5.1 Chat")
      let modelSegment = '';
      if (hasRoleSpecificPurpose) {
        modelSegment = modelName || fullModelName || 'Model';
      } else {
        modelSegment = `✓ ${fullModelName || 'Model'}`;
      }

      // Add thinking suffix if applicable
      const thinkingSuffix =
        this.thinkingEffort && this.thinkingEffort !== 'none'
          ? '・Thinking'
          : '';

      // Build final title:
      // Role-specific: 🎨 Design・Gemini 3 Pro Preview・Thinking
      // Non-role-specific: ✓ OpenAI: GPT-5.1 Chat
      const autoTitle = `${purposeSegment}${modelSegment}${thinkingSuffix}`;

      // Allow manual override via cardInfo.name
      return this.cardInfo?.name || autoTitle;
    },
  });

  @field leftBadge = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      return this.purpose && this.purpose !== ''
        ? this.purpose.toUpperCase()
        : 'RECOMMENDED';
    },
  });

  @field leftBadgeVariant = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      // Use 'recommended' variant for generic recommendation (between gray and purple)
      // Use 'purpose' variant for role-specific (purple)
      return this.purpose && this.purpose !== ''
        ? 'purpose'
        : 'recommended-badge';
    },
  });

  @field rightBadge = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      // Use bolt (⚡) for non-thinking models, lightbulb (💡) for thinking models
      if (this.thinkingEffort && this.thinkingEffort !== 'none') {
        return '💡';
      }
      return '⚡';
    },
  });

  @field rightBadgeVariant = contains(StringField, {
    computeVia: function (this: RecommendedModel) {
      return 'recommended';
    },
  });

  @field contextLength = contains(NumberField, {
    computeVia: function (this: RecommendedModel) {
      try {
        return this.modelConfiguration?.contextLength ?? null;
      } catch (e) {
        return null;
      }
    },
  });
}
