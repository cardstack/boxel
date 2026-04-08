# Skills System

The Skills System is how Boxel teaches AI agents about specific card types and operations. Skills provide structured context that helps the AI understand what cards exist, how to interact with them, and what commands are available.

## What is a Skill?

A Skill is a special card type that contains:

- **Instructions** — Natural language guidance for the AI
- **Commands** — Executable actions the skill enables
- **Context** — Card type information and examples

## Skill Architecture

```
Skills Realm
├── Skill Definitions (.gts)
│   └── Export Skill class with fields
└── Skill Instances (.json)
    └── Concrete skills with instructions and command links
```

## Creating a Skill

### 1. Define the Skill Instance

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "title": "Blog Post Manager",
      "instructions": "You help users manage blog posts.\n\nWhen a user wants to:\n- **Create a post**: Ask for title and content, then use CreateBlogPostCommand\n- **Publish a post**: Use the PublishCommand with the post URL\n- **List posts**: Search for BlogPost type cards\n\nAlways confirm before publishing."
    },
    "relationships": {
      "commands": {
        "data": [
          { "type": "card", "id": "./commands/create-blog-post" },
          { "type": "card", "id": "./commands/publish" }
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

### 2. Define Associated Commands

```typescript
import { Command } from 'https://cardstack.com/base/command';

class BlogPostInput extends CardDef {
  @field title = contains(StringField);
  @field body = contains(MarkdownField);
  @field status = contains(StringField);
}

export class CreateBlogPostCommand extends Command<
  typeof BlogPostInput,
  typeof BlogPost
> {
  static displayName = 'Create Blog Post';
  static description = 'Creates a new blog post';
  static requireInputFields = ['title', 'body'];

  async run(input: BlogPostInput): Promise<BlogPost> {
    const post = new BlogPost();
    post.title = input.title;
    post.body = input.body;
    post.status = input.status ?? 'draft';
    return post;
  }
}
```

## How Skills Are Loaded

1. **Discovery**: The AI bot queries the skills realm for available skills
2. **Relevance**: Skills are selected based on the conversation context
3. **Injection**: Skill instructions are included in the LLM prompt
4. **Execution**: When the AI decides to use a command, it's executed via the command framework

```
User message → AI Bot
                 ↓
          Load relevant skills
                 ↓
          Build prompt with skill instructions
                 ↓
          Send to LLM
                 ↓
          LLM responds (text or command request)
                 ↓
          Execute command if requested
                 ↓
          Return result to user
```

## Skill Instructions Best Practices

### Be Specific

```markdown
When the user asks to create a contact:
1. Ask for: first name, last name, and email (required)
2. Optionally ask for: phone number, company
3. Use CreateContactCommand with the gathered data
4. Confirm the contact was created with a summary
```

### Handle Edge Cases

```markdown
If the user provides incomplete information:
- Ask for missing required fields before proceeding
- Suggest reasonable defaults for optional fields

If a command fails:
- Explain what went wrong in simple terms
- Suggest how to fix the issue
```

### Provide Context

```markdown
The CRM system has these card types:
- Contact: person with name, email, phone, company link
- Company: organization with name, industry, website
- Deal: sales opportunity with value, stage, contacts

Contacts are always linked to a Company.
Deals reference one or more Contacts.
```

## Skills in VS Code

The VS Code Boxel Tools extension integrates skills with Cursor IDE:

1. Open the Skills panel in the sidebar
2. Browse available skills from all connected realms
3. Check/uncheck skills to activate them
4. Active skills generate a `.cursorrules` file
5. Cursor uses these rules for AI-assisted card development

### Skills Provider Flow

```
VS Code Extension
    ↓
Query /_search for Skill type cards
    ↓
Display in tree view with checkboxes
    ↓
User toggles skills
    ↓
Generate .cursorrules from active skills
    ↓
Cursor IDE picks up rules
```

## Skills Realm

The skills realm (`packages/skills-realm/`) is synced from the external `boxel-skills` repository. It contains production skills for:

- Card creation and editing
- Theme generation
- Data export
- Content generation
- And more

## Next Steps

- [Commands](/card-development/commands) — Command framework
- [Matrix Integration](/ai-agents/matrix-integration) — Communication
- [Building AI-Powered Cards](/ai-agents/building-ai-cards) — Practical guide
