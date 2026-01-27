# Bot Runner

This doc describes the bot runner process, how it registers, and how it is invited into AI assistant rooms.

## Overview

The bot runner is a separate Node process that listens to Matrix room events and can enqueue work via the realm server queue.

The bot runner is a valid matrix user and has admin access.

In order to use it, a user must
- invite the bot runner admin to a room
- register the bot via the realm-server bot-registration endpoint
- register bot commands so the bot runner knows what matrix event to listen to and the corresponding command to fire

## How to Run Locally

Environment variables:
- `MATRIX_URL` (default: `http://localhost:8008`)
- `BOT_RUNNER_USERNAME` (default: `bot-runner`)
- `BOT_RUNNER_PASSWORD` (default: `password`)
- `LOG_LEVELS` (default: `*=info`)
- `SENTRY_DSN` (optional)
- `SENTRY_ENVIRONMENT` (optional, default: `development`)

```
pnpm start:development
```


## Bot Registration

The realm server stores bot registration rows. This does not create a Matrix user; it records the internal `userId` (from the users table) and assigns a bot registration `id`.

### Register

Register (JSON:API):
- POST `/_bot-registration`
- Body:
  {
    "data": {
      "type": "bot-registration",
      "attributes": {
        "username": "@bot-runner:localhost"
      }
    }
  }
- The request must be authenticated with a realm server JWT.
- The `username` is the Matrix user id and must match the authenticated user id.

### List

List registrations:
- GET `/_bot-registrations`
- Only returns bot registrations for the authenticated user.

### Register via script

Register via script
```sh
REALM_SERVER_URL="http://localhost:4201" \
REALM_SERVER_JWT="..." \
USERNAME="@bot-runner:localhost" \
./packages/realm-server/scripts/register-bot.sh
```

Defaults and requirements:
- `REALM_SERVER_URL` (default: `http://localhost:4201`)
- `REALM_SERVER_JWT` (required)
- `USERNAME` (default: `@user:localhost`, Matrix user id)

### Unregister

Unregister:
- DELETE `/_bot-registration`
- Body:
  {
    "data": {
      "type": "bot-registration",
      "id": "<botRegistrationId>"
    }
  }
