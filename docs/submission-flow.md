# Submission Flow

## Testing with external catalog (`USE_EXTERNAL_CATALOG`)

Use this workflow when you want to validate submission behavior against content in `packages/catalog/contents` (from `boxel-catalog`), instead of `packages/catalog-realm`.

1. Start the host app (terminal 1):

```bash
cd packages/host
pnpm start
```
2. Delete catalog index 

```
DELETE FROM boxel_index WHERE realm_url ILIKE '%catalog%';
DELETE FROM boxel_index_working WHERE realm_url ILIKE '%catalog%';

```

2. Start the full realm-server stack with external catalog enabled (terminal 2):

```bash
cd packages/realm-server
USE_EXTERNAL_CATALOG=1 pnpm start:all
```

3. Ensure matrix users and submission bot setup are complete (run once, or rerun if needed):

```bash
cd packages/matrix
pnpm register-all
pnpm setup-submission-bot
```

4. Open `http://localhost:4200` and run the submission flow from a catalog listing.

## Notes

- `USE_EXTERNAL_CATALOG` is consumed by `packages/realm-server/scripts/start-development.sh`, and switches the catalog realm path to `../catalog/contents`.
- `pnpm start:services-for-matrix-tests` is not suitable for submission-flow testing because it starts with `SKIP_SUBMISSION=true`.
