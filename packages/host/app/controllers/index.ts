import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

import { HOST_APP_QUERY_PARAMS } from '@cardstack/runtime-common';

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
  @tracked openProfileSettings: string | null = null;
}
