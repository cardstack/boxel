import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';

const keyOf = (item: { id: string }) => item.id;

const notices = [
  {
    detail: 'main · 12 files',
    id: 'pass',
    title: 'Build passed',
    tone: 'pass',
  },
  { detail: '3 assertions', id: 'fail', title: 'Tests failed', tone: 'fail' },
] as const;

const initial = { opacity: 0, y: 18 };
const animate = { opacity: 1, y: 0 };
const exit = { opacity: 0, y: -28 };
const transition = {
  opacity: { duration: 0.28 },
  y: { bounce: 0.18, type: 'spring', visualDuration: 0.4 },
} as const;
const restMove = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.28,
} as const;

const modes = [
  { hint: 'Both at once', id: 'sync' },
  { hint: 'Exit first', id: 'wait' },
  { hint: 'Space collapses', id: 'popLayout' },
] as const;

type Mode = (typeof modes)[number]['id'];
type Notice = (typeof notices)[number];

export class PresenceModes extends Component {
  @tracked index = 0;

  get items(): Notice[] {
    return [notices[this.index]!];
  }

  swap = () => {
    this.index = this.index === 0 ? 1 : 0;
  };

  <template>
    <div class="ex">
      <button
        type="button"
        class="replay"
        {{on "click" this.swap}}
      >Switch</button>
      <div class="modes">
        {{#each modes as |mode|}}
          <ModeColumn
            @mode={{mode.id}}
            @hint={{mode.hint}}
            @items={{this.items}}
          />
        {{/each}}
      </div>
    </div>
  </template>
}

const ModeColumn = <template>
  <div class="mode">
    <LayoutGroup>
      <div class="mode-slot">
        <Presence
          @items={{@items}}
          @key={{keyOf}}
          @mode={{@mode}}
          @initial={{false}}
          as |notice h|
        >
          {{! layout=true matters most in `sync`. There, the leaver stays in
              flow for its whole exit, so the newcomer is laid out BELOW it and
              then has to get to the top once the leaver goes — without this it
              snaps that whole distance in a single frame. With it, the rise is
              animated, which is also what makes the three modes legible side
              by side: sync travels, wait does not move at all, and popLayout
              is already home because its leaver left flow immediately. }}
          <article
            class={{if (isFail notice) "toast is-fail" "toast is-pass"}}
            {{motion
              presence=h
              layout=true
              initial=initial
              animate=animate
              exit=exit
              transition=transition
            }}
          >
            <span class="toast-mark" aria-hidden="true"></span>
            <span class="toast-copy">
              <b>{{notice.title}}</b>
              <span>{{notice.detail}}</span>
            </span>
          </article>
        </Presence>
        <div class="mode-rest" {{motion layout=true transition=restMove}}>
          Up next
        </div>
      </div>
    </LayoutGroup>
    <span class="mode-name">{{@mode}}</span>
    <span class="mode-hint">{{@hint}}</span>
  </div>
</template> satisfies TOC<{
  Args: { hint: string; items: Notice[]; mode: Mode };
}>;

function isFail(notice: Notice) {
  return notice.tone === 'fail';
}
