# Building AI-Powered Cards

This guide walks through building cards that leverage AI capabilities — from simple AI-assisted fields to full AI-driven applications.

## Pattern 1: AI-Generated Content

Create cards where AI generates or enhances content:

```typescript
import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

export class AIArticle extends CardDef {
  static displayName = 'AI Article';

  @field topic = contains(StringField);
  @field tone = contains(StringField);  // "professional", "casual", etc.
  @field generatedContent = contains(MarkdownField);
  @field status = contains(StringField);
}
```

### With a Generation Command

```typescript
import { Command } from 'https://cardstack.com/base/command';

class GenerateArticleInput extends CardDef {
  @field topic = contains(StringField);
  @field tone = contains(StringField);
}

export class GenerateArticleCommand extends Command<
  typeof GenerateArticleInput,
  typeof AIArticle
> {
  static displayName = 'Generate Article';
  static description = 'Generate an article from a topic and tone';

  async run(input: GenerateArticleInput): Promise<AIArticle> {
    const article = new AIArticle();
    article.topic = input.topic;
    article.tone = input.tone;
    article.status = 'generating';
    // AI generates content via the LLM
    return article;
  }
}
```

### Wire Up with a Skill

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "title": "Article Writer",
      "instructions": "When asked to write an article:\n1. Ask for the topic and preferred tone\n2. Use GenerateArticleCommand\n3. Present the result for review"
    },
    "relationships": {
      "commands": {
        "data": [{ "type": "card", "id": "./commands/generate-article" }]
      }
    },
    "meta": {
      "adoptsFrom": { "module": "https://cardstack.com/base/skill", "name": "Skill" }
    }
  }
}
```

## Pattern 2: AI-Enhanced Data Entry

Use AI to auto-complete or suggest field values:

```typescript
export class SmartContact extends CardDef {
  static displayName = 'Smart Contact';

  @field name = contains(StringField);
  @field email = contains(EmailField);
  @field company = linksTo(Company);
  @field role = contains(StringField);
  @field notes = contains(TextAreaField);

  // AI-suggested fields
  @field suggestedTags = containsMany(StringField, {
    computeVia: function(this: SmartContact) {
      // Tags derived from role and company
      const tags: string[] = [];
      if (this.role?.toLowerCase().includes('engineer')) tags.push('technical');
      if (this.role?.toLowerCase().includes('manager')) tags.push('leadership');
      return tags;
    }
  });
}
```

## Pattern 3: AI-Powered Image Generation

Cards that generate images using AI services:

```typescript
export class ProductRotator extends CardDef {
  static displayName = 'Product Rotator';

  @field referenceImage = contains(StringField);  // URL
  @field description = contains(StringField);
  @field generatedImages = containsMany(ProductImage);

  @field imageCount = contains(NumberField, {
    computeVia: function(this: ProductRotator) {
      return this.generatedImages?.length ?? 0;
    }
  });
}

export class GenerateRotationCommand extends Command<
  typeof RotationInput,
  typeof ProductRotator
> {
  static displayName = 'Generate Product Rotation';
  static description = 'Generate 3D rotation images of a product';

  async run(input: RotationInput): Promise<ProductRotator> {
    // Calls image generation API
    // Returns product with generated rotation images
    return new ProductRotator();
  }
}
```

## Pattern 4: Conversational Card Builder

Let users describe what they want, and AI creates the card:

```
User: "I need a project tracker with tasks, milestones, and team members"

AI (using skills):
1. Creates ProjectTracker card definition
2. Creates Task, Milestone, TeamMember card definitions
3. Sets up relationships (linksToMany)
4. Generates templates for each format
5. Creates sample instances
```

This is enabled by having comprehensive skills that understand card architecture.

## Best Practices

### 1. Structured Input/Output

Always use typed card classes for command input and output — never raw JSON:

```typescript
// ✅ Good — typed input
class SearchInput extends CardDef {
  @field query = contains(StringField);
  @field maxResults = contains(NumberField);
}

// ❌ Bad — unstructured
async run(input: any) { ... }
```

### 2. Idempotent Commands

Design commands so they can be safely retried:

```typescript
async run(input: Input): Promise<Result> {
  // Check if already exists
  const existing = await this.findExisting(input);
  if (existing) return existing;

  // Create new
  return this.create(input);
}
```

### 3. Clear Skill Instructions

Write skill instructions like you're training a new team member:

```markdown
## Context
You're managing a CRM with Contacts, Companies, and Deals.

## Available Actions
- CreateContact: requires firstName, lastName, email
- UpdateContact: requires contactUrl, fields to update
- SearchContacts: accepts filter criteria

## Rules
- Always confirm before deleting
- Validate email format before creating contacts
- Link contacts to companies when possible
```

### 4. Error Handling

Commands should return meaningful errors:

```typescript
async run(input: Input): Promise<Result> {
  if (!input.requiredField) {
    const result = new Result();
    result.success = false;
    result.error = 'Required field missing: requiredField';
    return result;
  }
  // ... proceed
}
```

## Next Steps

- [Commands](/card-development/commands) — Command framework reference
- [Skills System](/ai-agents/skills-system) — Creating skills
- [AI Overview](/ai-agents/overview) — Architecture overview
