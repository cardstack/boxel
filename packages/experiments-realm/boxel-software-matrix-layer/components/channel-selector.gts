import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

// The channel vocabulary lives HERE (a leaf module) so both this selector
// and the publish command can import it without a module cycle — the
// command imports PropertyListing, whose isolated view mounts this
// selector.
export const PUBLISH_CHANNELS = [
  'mls',
  'zillow',
  'realtor',
  'redfin',
  'agent-site',
  'facebook',
  'instagram',
];

export const PUBLISH_CHANNEL_LABELS: Record<string, string> = {
  mls: 'MLS (Multiple Listing Service)',
  zillow: 'Zillow / Trulia',
  realtor: 'Realtor.com',
  redfin: 'Redfin',
  'agent-site': 'Agent Website',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

// Channel Selector — which distribution channels a listing goes to.
// Render-only: the consumer owns the selected set and flips it in
// `@onToggle`; MLS is painted checked and disabled because the command
// unions it in regardless (the portals syndicate FROM the MLS entry, so a
// publish without it is not a thing this desk sells).

interface Signature {
  Args: {
    selected: string[] | undefined;
    onToggle: (channel: string) => void;
  };
  Element: HTMLElement;
}

const AUTO_SYNCED = ['zillow', 'realtor', 'redfin'];

interface ChannelRow {
  channel: string;
  label: string;
  required: boolean;
  tag: string;
  subline?: string;
}

export class ChannelSelector extends GlimmerComponent<Signature> {
  channels = PUBLISH_CHANNELS;

  get rows(): ChannelRow[] {
    return this.channels.map((channel) => ({
      channel,
      label: PUBLISH_CHANNEL_LABELS[channel] ?? channel,
      required: channel === 'mls',
      tag:
        channel === 'mls'
          ? 'Required'
          : AUTO_SYNCED.includes(channel)
            ? 'Auto-synced'
            : 'Optional',
      subline:
        channel === 'mls'
          ? 'Triggers automatic syndication to major portals'
          : undefined,
    }));
  }

  isSelected = (channel: string) =>
    channel === 'mls' || (this.args.selected ?? []).includes(channel);

  toggle = (channel: string) => {
    if (channel === 'mls') {
      return;
    }
    this.args.onToggle(channel);
  };

  <template>
    <ul class='channels' ...attributes>
      {{#each this.rows as |row|}}
        <li class='channel'>
          <label class='channel-row {{if row.required "required"}}'>
            <input
              type='checkbox'
              checked={{this.isSelected row.channel}}
              disabled={{row.required}}
              {{on 'change' (fn this.toggle row.channel)}}
            />
            <span class='channel-body'>
              <span class='channel-line'>
                <span class='channel-label'>{{row.label}}</span>
                <span class='channel-tag'>{{row.tag}}</span>
              </span>
              {{#if row.subline}}
                <span class='channel-subline'>{{row.subline}}</span>
              {{/if}}
            </span>
          </label>
        </li>
      {{/each}}
    </ul>
    <style scoped>
      .channels {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--radius, var(--boxel-border-radius));
        overflow: hidden;
      }
      .channel + .channel {
        border-top: 1px solid var(--border, var(--boxel-200));
      }
      .channel-row {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        cursor: pointer;
        font-size: 0.8125rem;
      }
      .channel-row.required {
        cursor: default;
      }
      .channel-row input {
        margin-top: 2px;
        accent-color: var(--primary, var(--boxel-dark));
      }
      .channel-row input:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 1px;
      }
      .channel-body {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .channel-line {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .channel-label {
        font-weight: 500;
        color: var(--foreground, var(--boxel-dark));
      }
      .channel-tag {
        font-size: 0.6875rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .required .channel-tag {
        color: var(--primary, var(--boxel-dark));
        font-weight: 600;
      }
      .channel-subline {
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}

export default ChannelSelector;
