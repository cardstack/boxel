// Hands a session to the CLI waiting on its loopback port, once, as soon as
// the page is drawn, and says so while the browser navigates there.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';

import { handToCli } from '../../security/cli-handoff.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import type { Session } from '../../security/session.js';

import MessagePage from './message-page.gts';

interface Signature {
  Args: {
    // A value `isCliCallback` accepts; `handToCli` refuses anything else.
    callback: CliCallback;
    session: Session;
  };
}

export default class CliHandoff extends Component<Signature> {
  <template>
    <MessagePage @heading='Returning to your terminal…' @info='One moment.' />
  </template>

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    handToCli(args.callback, args.session);
  }
}
