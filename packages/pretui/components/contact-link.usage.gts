// Pretui — ContactLink usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CONTACT_CHANNELS, ContactLink, channelFor, contactHref, handleChannel } from './contact-link';
import type { ContactChannel } from './contact-link';

const VARIANTS = ['chip', 'row', 'icon'];

const GITHUB = handleChannel('github', 'GitHub', 'https://github.com/');

const MASTODON = handleChannel(
  'mastodon',
  'Mastodon',
  'https://mastodon.social/@',
  'Follow',
);

const CHANNEL_IDS = ['email', 'phone', 'sms', 'url', 'github', 'mastodon'];

const EXTRA: Record<string, ContactChannel> = {
  github: GITHUB,
  mastodon: MASTODON,
};

const SAMPLE_VALUES: Record<string, string> = {
  email: 'ada@example.com',
  phone: '+1 (555) 010-0199',
  sms: '+44 7700 900000',
  url: 'https://www.example.com/team/ada',
  github: '@ada',
  mastodon: 'ada',
};

/** Values that must never become a link. Shown with their resolved href, so
 * the empty column is the demonstration. */

const HOSTILE = [
  'javascript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD4=',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'a@b.com, javascript:alert(1)',
  '../../evil',
];

interface GuardRow {
  value: string;
  resolved: string;
}

class ContactLinkUsage extends Component {
  @tracked channelId = 'email';
  @tracked value = 'ada@example.com';
  @tracked name = 'Ada Lovelace';
  @tracked variant: 'chip' | 'row' | 'icon' = 'chip';
  @tracked showCta = true;
  @tracked hue = '';

  channelOptions = CHANNEL_IDS;
  variantOptions = VARIANTS;

  setChannel = (v: string) => {
    this.channelId = v;
    this.value = SAMPLE_VALUES[v] ?? '';
  };
  setValue = (v: string) => (this.value = v);
  setName = (v: string) => (this.name = v);
  setVariant = (v: string) =>
    (this.variant = v as 'chip' | 'row' | 'icon');
  setShowCta = (v: boolean) => (this.showCta = v);
  setHue = (v: string) => (this.hue = v);

  get channel(): ContactChannel | undefined {
    return EXTRA[this.channelId] ?? channelFor(this.channelId);
  }

  get href(): string {
    return contactHref(this.channel, this.value) ?? '(no link — shown as text)';
  }

  /** One of each shipped channel, so the whole set reads as one system. */
  get gallery(): Array<{ id: string; channel: ContactChannel; value: string }> {
    return CHANNEL_IDS.map((id) => ({
      id,
      channel: (EXTRA[id] ?? CONTACT_CHANNELS[id]) as ContactChannel,
      value: SAMPLE_VALUES[id] ?? '',
    }));
  }

  get guard(): GuardRow[] {
    return HOSTILE.map((value) => ({
      value,
      resolved: contactHref(this.channel, value) ?? '—',
    }));
  }

  get usage(): string {
    return (
      '<ContactLink' +
      " @channel='" +
      this.channelId +
      "'" +
      " @value='" +
      this.value +
      "'" +
      " @name='" +
      this.name +
      "' />"
    );
  }

  <template>
    <FreestyleUsage
      @name='ContactLink'
      @description='A contact detail that is also an action — the address AND the verb, in one control. Every href is BUILT from a validated value rather than passed through, so a stored javascript: URL never becomes a working link; a value that cannot be turned into a safe destination renders as text with a note rather than as a dead link or as nothing. Channels are keyed by a stable id and a whole channel can be passed as data, so the set grows without subclassing.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-contactdemo'>
          <ContactLink
            @channel={{this.channel}}
            @value={{this.value}}
            @name={{this.name}}
            @variant={{this.variant}}
            @showCta={{this.showCta}}
            @hue={{this.hue}}
          />
          <p class='pretui-contactdemo-note'>href: {{this.href}}</p>

          <p class='pretui-contactdemo-cap'>Every shipped channel, plus two
            passed in as data</p>
          <div class='pretui-contactdemo-row'>
            {{#each this.gallery key='id' as |entry|}}
              <ContactLink
                @channel={{entry.channel}}
                @value={{entry.value}}
                @name={{this.name}}
              />
            {{/each}}
          </div>

          <p class='pretui-contactdemo-cap'>The guard, working</p>
          <ul class='pretui-contactdemo-guard'>
            {{#each this.guard key='value' as |row|}}
              <li class='pretui-contactdemo-guardrow'>
                <span class='pretui-contactdemo-hostile'>{{row.value}}</span>
                <span class='pretui-contactdemo-resolved'>{{row.resolved}}</span>
              </li>
            {{/each}}
          </ul>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='channel'
          @value={{this.channelId}}
          @options={{this.channelOptions}}
          @description='A channel id (email, phone, sms, url) or a whole ContactChannel object. github and mastodon in this list are the second kind — handle channels built from a base URL with no code change. Resolution is by a stable id, never by the visible label, which is the lookup that silently breaks under renaming or translation.'
          @onInput={{this.setChannel}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @description='The address, number, handle or URL. Paste one of the hostile values from the table below into it and watch the component render text instead of a link.'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='name'
          @value={{this.name}}
          @description='Who or what it belongs to. Joins the accessible name, so a row of four contact links does not announce as four identical Email links — a failure that looks fine on screen.'
          @onInput={{this.setName}}
        />
        <Args.String
          @name='variant'
          @value={{this.variant}}
          @options={{this.variantOptions}}
          @defaultValue='chip'
          @description='chip is an inline pill, row is a full-width line with the verb at the end, icon is the mark alone with the name still required.'
          @onInput={{this.setVariant}}
        />
        <Args.Bool
          @name='showCta'
          @value={{this.showCta}}
          @defaultValue={{false}}
          @description='Show the verb beside the value in the chip variant. The row variant always shows it.'
          @onInput={{this.setShowCta}}
        />
        <Args.String
          @name='hue'
          @value={{this.hue}}
          @description='One hue in, a complete treatment out — the background and the ink are both derived from it, so any hue keeps its contrast in light and dark. Try a colour, then try red; background: url(x) to see the guard drop it whole.'
          @onInput={{this.setHue}}
        />
        <Args.Base
          @name='ContactChannel'
          @typeLabel='Interface'
          @description='id, label, cta, scheme, optional base for a handle channel, glyph, and external. handleChannel(id, label, base) builds one from a profile URL.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-contact-hue'
          @type='color'
          @defaultValue='var(--primary)'
          @description='The single hue the whole treatment derives from. Settable through the hue arg, which validates it first.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-contactdemo {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 520px;
      }
      .pretui-contactdemo-note {
        margin: 0;
        min-height: 1.4em;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        overflow-wrap: anywhere;
      }
      .pretui-contactdemo-cap {
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-xs, 10.5px);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-contactdemo-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2, 6px);
      }
      .pretui-contactdemo-guard {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 2px;
      }
      .pretui-contactdemo-guardrow {
        display: grid;
        grid-template-columns: 1fr 5rem;
        gap: var(--space-2, 6px);
        align-items: baseline;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 10.5px);
      }
      .pretui-contactdemo-hostile {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--muted-foreground);
      }
      .pretui-contactdemo-resolved {
        color: var(--success, var(--boxel-success));
      }
      @container (max-width: 360px) {
        .pretui-contactdemo-guardrow {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export const DEMOS_CONTACT_LINK: Record<string, unknown> = {
  ContactLink: ContactLinkUsage,
};
