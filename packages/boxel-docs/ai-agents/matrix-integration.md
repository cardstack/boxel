# Matrix Integration

Boxel uses the [Matrix](https://matrix.org/) protocol as its real-time communication layer. Matrix provides user identity, messaging, event broadcasting, and the backbone for AI agent interaction.

## Why Matrix?

| Feature | How Boxel Uses It |
|---------|-------------------|
| **Identity** | User authentication and session management |
| **Rooms** | Conversation spaces for AI chat and realm sync |
| **Events** | Real-time broadcasting of card/realm changes |
| **Federation** | Potential for cross-server collaboration |
| **Persistence** | Message history for chat and audit trails |
| **E2E Encryption** | Security for sensitive conversations |

## Architecture

```
┌────────────┐    ┌──────────────┐    ┌────────────┐
│  Host App  │◄──►│   Synapse    │◄──►│  AI Bot    │
│ (matrix-js)│    │  (Matrix     │    │ (matrix-js)│
│            │    │   server)    │    │            │
└────────────┘    └──────────────┘    └────────────┘
      │                  │                    │
      │           ┌──────▼──────┐             │
      └──────────►│ Realm Server│◄────────────┘
                  │ (JWT auth)  │
                  └─────────────┘
```

## Setup

### Synapse Server

Boxel runs a Synapse server via Docker:

```bash
cd packages/matrix
docker-compose up -d
```

Default ports:
- **8008** — Synapse API
- **8080** — Admin console
- **5001** — SMTP testing (smtp4dev)

### User Registration

```bash
cd packages/matrix
node scripts/register-user.js <username> <password>
```

## How Matrix Is Used

### 1. Authentication

Users log in via Matrix credentials. The Host App uses `matrix-js-sdk` to authenticate:

```
User enters credentials
    ↓
matrix-js-sdk authenticates against Synapse
    ↓
Access token returned
    ↓
Realm server creates JWT from Matrix token
    ↓
JWT used for all realm API calls
```

### 2. AI Chat

The AI Assistant Panel sends messages through Matrix rooms:

```
User types in chat panel
    ↓
Message sent to Matrix room
    ↓
AI Bot (also a Matrix client) receives message
    ↓
Bot processes with LLM and skills
    ↓
Response posted back to Matrix room
    ↓
Host App receives and displays response
```

### 3. Realm Event Broadcasting

When cards change, events are broadcast via Matrix:

```
Card saved in realm
    ↓
Realm adapter broadcasts Matrix event
    ↓
All connected clients receive event
    ↓
Clients invalidate caches and re-render
```

### 4. Session Rooms

Each realm session has a dedicated Matrix room for tracking:

```sql
-- Session rooms table
CREATE TABLE session_rooms (
  user_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  realm_url TEXT
);
```

## Matrix Client Integration

### Host App (MatrixService)

The Host App's `MatrixService` (2,266 lines) manages:

- Matrix client lifecycle
- Room management and joining
- Message sending and receiving
- Event subscriptions
- Session state persistence

```typescript
class MatrixService extends Service {
  // Initialize and sync
  async start(): Promise<void>

  // Send message to AI
  async sendMessage(roomId: string, content: string): Promise<void>

  // Subscribe to room events
  onRoomEvent(handler: (event: MatrixEvent) => void): void

  // Get room messages
  getMessages(roomId: string): Message[]
}
```

### AI Bot (Session Manager)

The AI Bot creates its own Matrix client session:

```typescript
// AI Bot connects as a Matrix user
const client = createClient({
  baseUrl: 'http://localhost:8008',
  userId: '@ai-bot:localhost',
  accessToken: '...'
});

// Listen for messages
client.on('Room.timeline', (event) => {
  if (event.getType() === 'm.room.message') {
    processMessage(event);
  }
});
```

## Event Types

### Realm Events

Boxel defines custom Matrix event types for realm operations:

| Event Type | Purpose |
|------------|---------|
| `APP_BOXEL_REALMS_EVENT_TYPE` | Realm list/metadata updates |
| Card update events | Individual card changes |
| Index events | Indexing progress notifications |

### Message Events

Standard Matrix message events used for AI chat:

| Type | Format |
|------|--------|
| `m.room.message` | User and AI chat messages |
| `m.room.member` | Room membership changes |

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MATRIX_URL` | Synapse server URL |
| `MATRIX_SERVER_NAME` | Matrix server name |
| `MATRIX_REGISTRATION_SECRET` | User registration secret |

### Docker Compose

The Matrix setup includes:

```yaml
services:
  synapse:
    image: matrixdotorg/synapse
    ports:
      - "8008:8008"
    volumes:
      - ./synapse-data:/data

  admin-console:
    image: awesometechnologies/synapse-admin
    ports:
      - "8080:80"

  smtp:
    image: rnwood/smtp4dev
    ports:
      - "5001:80"
```

## Testing with Matrix

Matrix integration tests use Playwright:

```bash
cd packages/matrix
pnpm test
```

Tests cover:
- User registration and login
- Room creation and joining
- Message sending and receiving
- AI bot interaction
- Realm event broadcasting

## Next Steps

- [AI & Agents Overview](/ai-agents/overview) — Full AI integration
- [Skills System](/ai-agents/skills-system) — AI skills
- [Authentication](/architecture/auth-and-permissions) — Auth system
