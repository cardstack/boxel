import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { format as formatDate } from 'date-fns';

import { AiSessionRoom } from '@cardstack/host/components/ai-assistant/panel';

interface Signature {
  Args: {
    sessions: AiSessionRoom[];
    onSessionSelect: (roomId: string) => void;
  };
  Element: HTMLButtonElement;
}

export default class AiAssistantPastSessionsList extends Component<Signature> {
  <template>
    <style>
      ul {
        list-style-type: none;
        padding: 0;
        margin: 0;
      }

      li {
        border-top: 1px solid var(--boxel-300);
        padding-top: var(--boxel-sp-sm);
        padding-left: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-sm);
        margin-right: var(--boxel-sp-xs);
        margin-left: var(--boxel-sp-xs);
      }

      li > button {
        background-color: transparent;
        border: none;
        width: 100%;
        text-align: left;
      }

      li:hover {
        background-color: var(--boxel-200);
        cursor: pointer;
        border-radius: 8px;
      }

      li:hover + li {
        border-top: none;
      }

      .top {
        font-weight: 600;
      }

      .bottom {
        margin-top: var(--boxel-sp-4xs);
        color: #7e7c8d;
      }
    </style>

    <ul>
      {{#each @sessions as |session|}}
        <li data-test-enter-room={{session.room.name}}>
          <button {{on 'click' (fn @onSessionSelect session.room.roomId)}}>
            <div class='top'>{{session.room.name}}</div>
            <div class='bottom'>{{formatDate
                session.member.membershipDateTime
                'iiii MMM d, yyyy, h:mm aa'
              }}</div>
          </button>
        </li>
      {{/each}}
    </ul>
  </template>
}
