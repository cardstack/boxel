# AI & Agents Overview

Boxel is designed from the ground up to be **AI-native**. Cards are structured, typed data that AI agents can read, create, modify, and reason about. The AI integration layer connects large language models to the card system through a sophisticated skill and command framework.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    User                           │
│              (Host App Chat UI)                   │
└────────────────────┬─────────────────────────────┘
                     │ Messages
                     ▼
┌──────────────────────────────────────────────────┐
│              Matrix Protocol                      │
│         (Rooms, Events, Real-time)                │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────┐
│                AI Bot                             │
│                                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │   Skills   │  │  Commands  │  │    LLM     │ │
│  │  (context) │  │  (actions) │  │ (reasoning)│ │
│  └────────────┘  └────────────┘  └────────────┘ │
└────────────────────┬─────────────────────────────┘
                     │ Card Operations
                     ▼
┌──────────────────────────────────────────────────┐
│              Realm Server                         │
│       (Create, Read, Update, Delete cards)        │
└──────────────────────────────────────────────────┘
```

## Key Components

### AI Bot (`packages/ai-bot/`)

A Node.js service that acts as a Matrix client:

- **Listens** for user messages in Matrix rooms
- **Loads skills** to understand card-specific behaviors
- **Sends prompts** to LLMs (OpenAI, OpenRouter)
- **Executes commands** to create or modify cards
- **Returns results** as Matrix messages
- **Tracks errors** via Sentry

### Skills System

Skills are card definitions that provide context and instructions for the AI:

```
Skill Card
├── Title: "CRM Contact Creator"
├── Instructions: "When asked to create a contact..."
└── Commands: [CreateContactCommand, UpdateContactCommand]
```

Skills bridge the gap between natural language requests and structured card operations.

### Command Framework

Commands are executable actions the AI can invoke:

```
User: "Create a contact for Alice Johnson"
  ↓
AI loads CRM skill
  ↓
AI constructs CreateContactCommand input
  ↓
Command executes, creates card
  ↓
AI confirms: "Created contact Alice Johnson"
```

### Matrix Integration

Matrix provides the communication backbone:

- **Authentication** — User identity via Matrix credentials
- **Rooms** — Conversation spaces for user-AI interaction
- **Events** — Real-time message delivery
- **Persistence** — Message history stored in Synapse

## How AI Interacts with Cards

### Reading Cards

The AI can query cards via the search API and read their structured data:

```
AI receives: "What contacts do we have at Acme Corp?"
AI searches: { filter: { eq: { "company.name": "Acme Corp" } } }
AI returns: "Found 3 contacts at Acme Corp: Alice, Bob, Carol"
```

### Creating Cards

Via commands, the AI creates new card instances:

```
AI receives: "Create a new blog post about Boxel"
AI executes: CreateCardCommand({
  title: "Introduction to Boxel",
  body: "...",
  status: "draft"
})
AI returns: "Created draft blog post 'Introduction to Boxel'"
```

### Modifying Cards

The AI can patch existing cards:

```
AI receives: "Mark the login bug task as complete"
AI executes: PatchCardCommand({
  cardUrl: "/tasks/fix-login",
  fields: { status: "completed" }
})
AI returns: "Marked 'Fix login bug' as completed"
```

## AI Assistant Panel

The Host App includes a dedicated AI Assistant Panel:

- Chat interface integrated into the workspace
- Shows card previews in responses
- Command execution feedback
- Skill activation indicators
- Message history with Matrix persistence

## Credit System

AI operations consume credits:

| Plan | Credits/Month |
|------|--------------|
| Free | 1,000 |
| Creator | 5,000 |
| Power User | 25,000 |

Each AI interaction (message, command) consumes credits tracked via `credit_balance_events`.

## Getting Started with AI

1. **Set up Matrix** — Configure Synapse for authentication
2. **Register AI bot** — Run the AI bot service
3. **Configure LLM** — Set OpenAI/OpenRouter API keys
4. **Create skills** — Define skills for your card types
5. **Chat** — Use the AI Assistant Panel in the Host App

## Next Steps

- [Skills System](/ai-agents/skills-system) — Creating AI skills
- [Matrix Integration](/ai-agents/matrix-integration) — Communication layer
- [Building AI-Powered Cards](/ai-agents/building-ai-cards) — Practical guide
- [Commands](/card-development/commands) — Command framework
