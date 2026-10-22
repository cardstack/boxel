// Pretui — EmojiButton usage page.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { EmojiButton } from './emoji-button';
import type { EmojiSelection } from './emoji-picker';
import { FreestyleUsage } from './freestyle-usage';

// ── EmojiButton ──────────────────────────────────────────────────────────

class EmojiButtonUsage extends Component {
  @tracked label = 'Insert emoji';
  @tracked glyph = '🙂';
  @tracked placement: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' =
    'bottom-start';

  @tracked draft = '';
  @tracked skinTone = 0;
  @tracked recent: readonly string[] = [];

  setLabel = (v: string) => (this.label = v);
  setGlyph = (v: string) => (this.glyph = v);
  setPlacement = (v: string) =>
    (this.placement = v as 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end');

  insert = (selection: EmojiSelection) => (this.draft = this.draft + selection.unicode);
  onSkinTone = (tone: number) => (this.skinTone = tone);
  onRecent = (recent: readonly string[]) => (this.recent = recent);
  onDraft = (event: Event) => (this.draft = (event.target as HTMLTextAreaElement).value);

  readonly placements = ['bottom-start', 'bottom-end', 'top-start', 'top-end'];

  get usage(): string {
    return (
      "<EmojiButton @onSelect={{this.insert}} @placement='" +
      this.placement +
      "' />"
    );
  }

  <template>
    <FreestyleUsage
      @name='EmojiButton'
      @description='The affordance that opens a picker in a popover. Placement,
        the dismiss backdrop and Escape all come from Popover
        rather than being reinvented, so the panel inherits the overlay z-tier
        and this component hard-codes no stacking number — the only thing that
        stacks is the picker own skin-tone list, on --pretui-z-dropdown. The
        composer below is a plain textarea: this is the shape an adoption looks
        like, not a component the kit ships.'
      @source={{this.usage}}
    >
      <:example>
        <div class='emoji-composer'>
          <label class='emoji-composer-label' for='emoji-demo-draft'>Message</label>
          <textarea
            id='emoji-demo-draft'
            class='emoji-composer-field'
            rows='3'
            value={{this.draft}}
            {{on 'input' this.onDraft}}
          ></textarea>
          <div class='emoji-composer-bar'>
            <EmojiButton
              @onSelect={{this.insert}}
              @label={{this.label}}
              @glyph={{this.glyph}}
              @placement={{this.placement}}
              @skinTone={{this.skinTone}}
              @onSkinTone={{this.onSkinTone}}
              @recent={{this.recent}}
              @onRecent={{this.onRecent}}
            />
            <span class='emoji-composer-hint'>
              Picking appends to the draft; the popover closes on selection.
            </span>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @defaultValue='Insert emoji'
          @value={{this.label}}
          @description='Accessible name for the trigger, and the name of the
            popover it opens. The glyph is aria-hidden, so nothing depends on
            an emoji being read aloud.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='glyph'
          @defaultValue='🙂'
          @value={{this.glyph}}
          @description='Emoji painted on the trigger. It is a glyph rather
            than an icon because icon-registry.gts has no face; a kit-wide
            icon would be the better long-term answer.'
          @onInput={{this.setGlyph}}
        />
        <Args.String
          @name='placement'
          @defaultValue='bottom-start'
          @value={{this.placement}}
          @options={{this.placements}}
          @description='Forwarded to Popover, which flips to the opposite side
            when there is not room and clamps along the cross axis.'
          @onInput={{this.setPlacement}}
        />
        <Args.Action
          @name='onSelect'
          @description='Receives the same selection object EmojiPicker emits.
            The popover closes immediately after.'
        />
        <Args.Number
          @name='skinTone'
          @description='Forwarded to the picker. Hold it here and the tone
            survives the popover closing.'
        />
        <Args.Array
          @name='recent'
          @description='Forwarded to the picker. Hold it here and the recents
            tab survives the popover closing.'
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .emoji-composer {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-inline-size: 26rem;
      }

      .emoji-composer-label {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .emoji-composer-field {
        inline-size: 100%;
        padding: 8px;
        border: 0;
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        color: var(--foreground);
        font: inherit;
        box-shadow: inset 0 0 0 1px var(--input);
        resize: vertical;
      }

      .emoji-composer-field:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }

      .emoji-composer-bar {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .emoji-composer-hint {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_EMOJI_BUTTON: Record<string, unknown> = {
  EmojiButton: EmojiButtonUsage,
};
