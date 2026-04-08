# Skills

Skills are special card types that define behaviors for the AI assistant. They tell the AI how to interact with specific card types, what commands to use, and what patterns to follow.

## What is a Skill?

A **Skill Card** is a card that:
- Contains instructions for the AI assistant
- References specific commands it can execute
- Defines patterns for card creation and modification
- Lives in the skills realm

## Skill Card Structure

```typescript
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

export class Skill extends CardDef {
  static displayName = 'Skill';

  @field title = contains(StringField);
  @field instructions = contains(MarkdownField);
  @field commands = linksToMany(Command);
}
```

## How Skills Work

```
User asks AI to do something
        ↓
AI assistant loads relevant Skills
        ↓
Skills provide:
  - Instructions (how to approach the task)
  - Commands (what actions to take)
  - Examples (patterns to follow)
        ↓
AI executes commands with structured input
        ↓
Results displayed in chat
```

## The Skills Realm

Skills live in the **skills realm** (`packages/skills-realm/`), which is synced from the external `boxel-skills` repository:

```
skills-realm/
├── skill-definitions/
│   ├── card-creation.gts
│   ├── theme-generation.gts
│   └── data-export.gts
└── skill-instances/
    ├── create-contact.json
    ├── generate-theme.json
    └── export-data.json
```

## Skills in the VS Code Extension

The VS Code Boxel Tools extension integrates skills with Cursor IDE:

1. **Skills Provider** fetches available skills from realms
2. Users can check/uncheck skills to activate them
3. Active skills generate a `.cursorrules` file
4. Cursor IDE uses these rules for AI-assisted development

## Skills Discovery

Skills are discovered via the search API:

```json
{
  "filter": {
    "type": {
      "module": "https://cardstack.com/base/skill",
      "name": "Skill"
    }
  },
  "sort": [
    {
      "by": "title",
      "on": {
        "module": "https://cardstack.com/base/card-api",
        "name": "CardDef"
      }
    }
  ]
}
```

## Creating Custom Skills

### 1. Define the Skill

Create a skill card that instructs the AI:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "title": "CRM Contact Creator",
      "instructions": "When the user asks to create a contact:\n1. Ask for first name, last name, and email\n2. Use the CreateContact command\n3. Confirm the contact was created"
    },
    "relationships": {
      "commands": {
        "data": [
          { "type": "card", "id": "./commands/create-contact" }
        ]
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "https://cardstack.com/base/skill",
        "name": "Skill"
      }
    }
  }
}
```

### 2. Wire Up Commands

Skills reference commands that the AI can execute:

```typescript
export class CreateContactCommand extends Command<
  typeof ContactInput,
  typeof ContactResult
> {
  static displayName = 'Create Contact';

  async run(input: ContactInput): Promise<ContactResult> {
    // Create the contact card
    const contact = new Contact();
    contact.firstName = input.firstName;
    contact.lastName = input.lastName;
    contact.email = input.email;
    // ... save to realm
    return new ContactResult({ success: true });
  }
}
```

## Next Steps

- [Commands](/card-development/commands) — Command system
- [AI & Agents Overview](/ai-agents/overview) — Full AI integration
- [Matrix Integration](/ai-agents/matrix-integration) — Communication layer
