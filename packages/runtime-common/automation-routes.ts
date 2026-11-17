// The realm server's routes for a direct writer to switch an automation on,
// start a Preview or a Run now, pause, resume or remove it, and cancel one of
// its runs. Each is an authenticated realm-server route: it acts as the
// session's own user, never as a user a header names (ADR 006), and answers
// only a direct writer of the realm the request names.
//
// Every request names the realm and the automation card (or the run), and
// the route checks the caller's direct write on that realm before it reads
// anything else, so a caller who isn't a direct writer learns nothing about
// the realm's automations or runs.

export const AUTOMATION_SWITCH_ON_PATH = '/_automation-switch-on';
export const AUTOMATION_PREVIEW_PATH = '/_automation-preview';
export const AUTOMATION_RUN_NOW_PATH = '/_automation-run-now';
export const AUTOMATION_PAUSE_PATH = '/_automation-pause';
export const AUTOMATION_RESUME_PATH = '/_automation-resume';
export const AUTOMATION_REMOVE_PATH = '/_automation-remove';
export const AUTOMATION_RUN_CANCEL_PATH = '/_automation-run-cancel';

// The query parameters of `GET /_automation-switch-on`, which answers the
// estimate the switch-on screen shows.
export const AUTOMATION_ROUTE_REALM_PARAM = 'realm';
export const AUTOMATION_ROUTE_AUTOMATION_PARAM = 'automation';

export const AUTOMATION_RESOURCE_TYPE = 'automation';
export const AUTOMATION_RUN_RESOURCE_TYPE = 'automation-run';
export const AUTOMATION_ESTIMATE_RESOURCE_TYPE = 'automation-estimate';

// The body of a request about an automation: the card by its URL, in the
// realm named by `attributes.realm`.
//
// - switch-on and resume: `monthlyCredits` is the monthly credit cap the
//   caller agrees to pay up to. It must be the card's own
//   `caps.monthlyCredits`, so the monthly cap the caller confirmed is the one
//   the automation's caps snapshot holds. A card whose monthly cap changed
//   since the caller read it is refused, and the caller reads the estimate
//   again. Only the monthly cap is compared: the rest of the snapshot (the
//   triggers' timing, the per-run and daily caps, `batchedAI`) is taken from
//   the card as it is when the route reads it, and spending stays within the
//   confirmed monthly cap whatever they say.
// - Preview and Run now: `click` is a fresh id per click. Sending the same
//   click again answers the run it started rather than starting another.
export interface AutomationRequestBody {
  data: {
    type: typeof AUTOMATION_RESOURCE_TYPE;
    id: string;
    attributes: {
      realm: string;
      monthlyCredits?: number;
      click?: string;
    };
  };
}

// The body of a request to cancel a run: the run by its id, in the realm
// named by `attributes.realm`.
export interface AutomationRunCancelBody {
  data: {
    type: typeof AUTOMATION_RUN_RESOURCE_TYPE;
    id: string;
    attributes: { realm: string };
  };
}
