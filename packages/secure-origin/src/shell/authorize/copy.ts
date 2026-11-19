// The authorize page's wording that more than one of its states shares.
import type { AppName } from '../../security/oauth-provider.ts';

// The app as a page names it in its sentences. A client that registered
// itself is named by the name it gave, quoted, since Boxel can't vouch for
// it; without one, and for every other client, by the name Boxel can check.
export function appNameShown(app: AppName): string {
  return app.kind === 'dynamic' && app.claimedName
    ? `“${app.claimedName}”`
    : app.shown;
}

// What the page says about how long the connection lasts. Kept for 30 days,
// it needs no line; otherwise it ends 60 minutes after it is allowed.
export function renewalLine(renewing: boolean): string | undefined {
  return renewing
    ? undefined
    : 'The connection ends 60 minutes after you allow it. You’ll need to connect again after that.';
}
