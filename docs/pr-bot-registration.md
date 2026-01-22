# Bot registration PR notes

Short summary of the bot registration updates in this PR, focused on the three endpoints:

## Endpoints

### `POST /_bot-registration`
- Registers a bot for the authenticated user.
- Once registered, the bot filters out events in rooms it is invited to.
- Requires a realm server JWT.
- `matrixUserId` must match the authenticated user.
- Returns `201` with the created registration or `200` when the default registration already exists.

### `GET /_bot-registrations`
- Lists bot registrations for the authenticated user only.
- Requires a realm server JWT.

### `DELETE /_bot-registration`
- Unregisters a bot by id for the authenticated user.
- Requires a realm server JWT.
- Returns `204` on success.
