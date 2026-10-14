---
name: grafana-add-credit
description: Grant Boxel AI credits (extra_credit) to a user through the Grafana Users dashboard on staging or production. Use when someone asks to "add credits", "give me credits", "top up a user", "grant extra credit", or asks where the Grafana credit button is.
allowed-tools: Read, Bash
---

# grafana-add-credit

Credits are granted from a button on the Grafana **Users** dashboard, not by SQL. The button POSTs to the realm-server's `/_grafana-add-credit` endpoint (`packages/realm-server/handlers/handle-add-credit.ts`), which inserts one `credits_ledger` row with `credit_type = 'extra_credit'` for the user.

## Grafana URLs

From `packages/observability/grafanactl/config.yaml`:

| Env        | Grafana                               |
| ---------- | ------------------------------------- |
| Production | https://dashboard.boxel.ai            |
| Staging    | https://dashboard-staging.stack.cards |
| Local      | http://localhost:3001 (admin / admin) |

## Steps

1. **Get the exact Matrix user ID.** The endpoint matches `users.matrix_user_id` exactly, so a typo fails with `user "…" does not exist`. If unsure, run this in Grafana **Explore** (Postgres datasource, Code mode):
   ```sql
   SELECT matrix_user_id, created_at FROM users WHERE matrix_user_id ILIKE '%<name>%';
   ```
2. **Open the Users dashboard** (uid `boxelusers0001`, source `packages/observability/grafanactl/resources/dashboards/boxel-status/users.json`) with the user preselected:
   ```
   <grafana>/d/boxelusers0001?var-matrix_user_id=<url-encoded id, @ → %40>
   ```
3. In the **Add Extra Credit to …** panel, check "Current state" shows the right user's balance.
4. Click **+1,000**, **+10,000**, **+100,000** or set **Custom amount** and click **Add custom amount**. Confirm the browser prompt.
5. Refresh the panel. "Remaining extra credit" and "Last extra-credit grant" should reflect the grant.

## Gotchas

- **Production credits are real.** Use staging for testing unless the user explicitly wants prod.
- **Explore can't grant.** It's read-only querying; the buttons exist only on the dashboard.
- **Don't INSERT into `credits_ledger` by hand.** Go through the button so the grant takes the same path every time.
- **No undo button.** The endpoint accepts any integer (only the UI blocks ≤ 0), so a mistaken grant needs a deliberate correcting grant — ask before doing that.
- The realm-server auth (`grafana_secret`) is injected into the dashboard at apply time, so the operator never handles a secret.
