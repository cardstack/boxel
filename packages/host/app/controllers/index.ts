import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

import { HOST_APP_QUERY_PARAMS } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

export default class IndexController extends Controller {
  // Declared in runtime-common so the realm server reads the same list
  // when it decides which params a redirect rule may carry onto its
  // target. `debug` is a temporary param for debugging AI assistant code
  // patches.
  queryParams = HOST_APP_QUERY_PARAMS;

  @tracked authRedirect: string | null = null;
  @tracked hostModeOrigin: string | null = null;
  @tracked hostModeStack: string | null = null;
  @tracked operatorModeState: string | null = null;
  @tracked sid: string | null = null;
  @tracked clientSecret: string | null = null;
  @tracked debug = false;
  // Set when a `?loginToken` account switch fails before any teardown (the token
  // was expired/spent), so the operator-mode container shows the
  // "couldn't switch accounts" page instead of the current workspace. Not a
  // query param — it is transient in-app state, cleared by "Back to home".
  @tracked accountSwitchFailed = false;
  // Shows per-message and per-session AI token counts in the assistant
  // panel. On by default in development (pass showTokens=false to hide);
  // opt-in everywhere else. The default doubles as the query param's
  // serialization baseline: the URL only carries the param when the value
  // differs from it.
  @tracked showTokens = ENV.environment === 'development';
  @tracked openProfileSettings: string | null = null;
}
