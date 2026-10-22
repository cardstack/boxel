// Hands a session to the CLI waiting on its loopback port, once, as soon as
// the page is drawn, and says so while the browser navigates there.
import Component from '@glimmer/component';

import { handToCli } from '../../security/cli-handoff.js';

import MessagePage from './message-page.gts';

interface Signature {
  Args: {
    // Only ever a value `cliCallback` returned.
    callback: { url: string; state: string };
    session: { token: string; user: string; expiresAt: string };
  };
}

export default class CliHandoff extends Component<Signature> {
  <template>
    <MessagePage @heading='Returning to your terminal…' @info='One moment.' />
  </template>

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    handToCli(args.callback, args.session);
  }
}
