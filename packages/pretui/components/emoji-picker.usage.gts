// Pretui — EmojiPicker usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { EmojiPicker } from './emoji-picker';
import type { EmojiSelection } from './emoji-picker';
import { FreestyleUsage } from './freestyle-usage';

// ── EmojiPicker ──────────────────────────────────────────────────────────

class EmojiPickerUsage extends Component {
  @tracked columns = 9;
  @tracked recentLimit = 18;
  @tracked autofocus = false;
  @tracked label = 'Emoji picker';

  @tracked skinTone = 0;
  @tracked recent: readonly string[] = [];
  @tracked picked: EmojiSelection | undefined;

  setColumns = (v: number) => (this.columns = v);
  setRecentLimit = (v: number) => (this.recentLimit = v);
  setAutofocus = (v: boolean) => (this.autofocus = v);
  setLabel = (v: string) => (this.label = v);

  onSelect = (selection: EmojiSelection) => (this.picked = selection);
  onSkinTone = (tone: number) => (this.skinTone = tone);
  onRecent = (recent: readonly string[]) => (this.recent = recent);

  get recentReadout(): string {
    return this.recent.length ? this.recent.join('  ') : '(nothing picked yet)';
  }

  get pickedReadout(): string {
    if (!this.picked) {
      return '(nothing picked yet)';
    }
    return this.picked.unicode + '  ' + this.picked.annotation;
  }

  get usage(): string {
    let bits = ['@onSelect={{this.insert}}'];
    if (this.columns !== 9) {
      bits.push('@columns=' + String(this.columns));
    }
    if (this.recentLimit !== 18) {
      bits.push('@recentLimit=' + String(this.recentLimit));
    }
    if (this.autofocus) {
      bits.push('@autofocus=true');
    }
    return '<EmojiPicker ' + bits.join(' ') + ' />';
  }

  <template>
    <FreestyleUsage
      @name='EmojiPicker'
      @description='A searchable emoji picker with category tabs, skin-tone
        selection, a recently-used list and a keyboard-complete grid. Search,
        ranking and skin-tone handling are ported from emoji-picker-element
        (Apache-2.0); the UI is Pretui, because that library delivers its
        controls inside a shadow root with 27 custom properties and no slots —
        no font, no shadow and a dark branch of its own. The 1,923-emoji
        dataset is local and lazily imported, so the picker makes no network
        request and works offline. Everything but the first Tab is arrow keys:
        the grid is one tab stop with roving tabindex, arrows move in two
        dimensions, Home and End go to the row ends, Ctrl with them goes to
        the ends of the whole category, PageUp and PageDown move five rows,
        and ArrowUp out of the top row returns to the search field.'
      @source={{this.usage}}
    >
      <:example>
        <div class='emoji-stage'>
          <EmojiPicker
            @onSelect={{this.onSelect}}
            @columns={{this.columns}}
            @recentLimit={{this.recentLimit}}
            @autofocus={{this.autofocus}}
            @label={{this.label}}
            @skinTone={{this.skinTone}}
            @onSkinTone={{this.onSkinTone}}
            @recent={{this.recent}}
            @onRecent={{this.onRecent}}
          />
          <dl class='emoji-readout'>
            <dt>Last pick</dt>
            <dd>{{this.pickedReadout}}</dd>
            <dt>Recent, most recent first</dt>
            <dd class='emoji-mono'>{{this.recentReadout}}</dd>
            <dt>Skin tone</dt>
            <dd class='emoji-mono'>{{this.skinTone}}</dd>
          </dl>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='columns'
          @defaultValue={{9}}
          @value={{this.columns}}
          @description='Columns in the grid, clamped to 4-16. Drives the
            arrow-key geometry as well as the layout, so ArrowDown always
            means "one row down" whatever the caller picks.'
          @onInput={{this.setColumns}}
        />
        <Args.Number
          @name='recentLimit'
          @defaultValue={{18}}
          @value={{this.recentLimit}}
          @description='How many recently-used emoji to keep, 0-64. Set 0 to
            drop the recents tab entirely.'
          @onInput={{this.setRecentLimit}}
        />
        <Args.Bool
          @name='autofocus'
          @defaultValue={{false}}
          @value={{this.autofocus}}
          @description='Focus the search field on insert. Off by default —
            a picker rendered inline must not steal focus; EmojiButton turns
            it on because a popover that opens should be typed into.'
          @onInput={{this.setAutofocus}}
        />
        <Args.String
          @name='label'
          @defaultValue='Emoji picker'
          @value={{this.label}}
          @description='Accessible name for the whole picker.'
          @onInput={{this.setLabel}}
        />
        <Args.Number
          @name='skinTone'
          @description='Active skin tone 0-5. Controlled when supplied — pair
            it with @onSkinTone and persist the value to make the choice
            sticky across sessions.'
        />
        <Args.Action
          @name='onSkinTone'
          @description='Receives the new tone as a number 0-5.'
        />
        <Args.Array
          @name='recent'
          @description='Recently-used emoji, MOST RECENT FIRST, as untoned
            unicode strings. Ordering is positional and carries no timestamp:
            Date.now() is forbidden in realm code, and "most recent" is
            "index 0". Controlled when supplied; otherwise the picker keeps a
            session-local list.'
        />
        <Args.Action
          @name='onRecent'
          @description='Receives the new recent array after every pick.
            Persist it verbatim — it is already the storage format.'
        />
        <Args.Number
          @name='emojiVersion'
          @description='Pin the emoji version instead of detecting it.
            Detection draws fourteen 1x1 canvases to find the newest version
            the font can actually paint, and hides anything newer so you get
            no tofu. Pin it to make a screenshot test deterministic.'
        />
        <Args.Action
          @name='onSelect'
          @description='Receives { unicode, annotation, base, skinTone }.
            `unicode` has the tone applied and is what you insert; `base` is
            the untoned identity used by the recent list; `annotation` is the
            CLDR name and is safe to use as alt text.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-emoji-width'
          @type='dimension'
          @description='Max width of the picker. Default 22rem.'
        />
        <Css.Basic
          @name='pretui-emoji-height'
          @type='dimension'
          @description='Height of the scrolling grid. Default 15rem.'
        />
        <Css.Basic
          @name='pretui-emoji-cell'
          @type='dimension'
          @description='Cell size. Default 2rem, and 2.75rem on coarse
            pointers so touch targets clear 44px.'
        />
        <Css.Basic
          @name='pretui-emoji-glyph'
          @type='dimension'
          @description='Emoji font size inside a cell. Default 1.25rem.'
        />
        <Css.Basic
          @name='pretui-emoji-font'
          @type='string'
          @description='Colour-emoji font stack. Twemoji Mozilla is listed
            first on purpose: Firefox bundles it on Windows and Linux and
            updates faster than the OS, so leaving it later mixes glyph
            generations within one grid.'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .emoji-stage {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 20px;
      }

      .emoji-readout {
        display: grid;
        grid-template-columns: max-content;
        gap: 2px 0;
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
      }

      .emoji-readout dt {
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .emoji-readout dd {
        margin: 0 0 10px;
        color: var(--foreground);
      }

      .emoji-mono {
        font-family: var(--font-mono);
      }
    </style>
  </template>
}

export const DEMOS_EMOJI_PICKER: Record<string, unknown> = {
  EmojiPicker: EmojiPickerUsage,
};
