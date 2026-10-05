// Pretui — Avatar usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Avatar } from './avatar';
import { AvatarGroup } from './avatar-group';
import { HUE_OPTIONS } from '../demo-ink-feedback';

// ── Avatar ← avatar/usage.gts ────────────────────────────────────────────
// Dropped knobs: userId (Pretui hue + initials derive from @name alone),
// isReady (no async readiness gate — Avatar renders immediately).
class AvatarUsage extends GlimmerComponent {
  @tracked name = 'John Doe';
  @tracked src = '';
  @tracked hue = '';
  @tracked size = 40;
  setName = (v: string) => (this.name = v);
  setSrc = (v: string) => (this.src = v);
  setHue = (v: string) => (this.hue = v);
  setSize = (v: number | null) => {
    if (v !== null) {
      this.size = v;
    }
  };
  get srcVal() {
    return this.src || undefined;
  }
  get hueVal() {
    return this.hue || undefined;
  }
  <template>
    <FreestyleUsage
      @name='Avatar'
      @description="An avatar component that displays a user's initials on a colored background."
    >
      <:example>
        <Avatar
          @name={{this.name}}
          @src={{this.srcVal}}
          @hue={{this.hueVal}}
          @size={{this.size}}
        />
        <AvatarGroup>
          <Avatar @name='John Doe' @size={{28}} />
          <Avatar @name='Ada Lovelace' @size={{28}} />
          <Avatar @name='Grace Hopper' @size={{28}} />
          <Avatar @name='Alan Turing' @size={{28}} />
        </AvatarGroup>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='name'
          @required={{true}}
          @description='User display name — drives the initials and the name-derived hue.'
          @value={{this.name}}
          @onInput={{this.setName}}
        />
        <Args.String
          @name='src'
          @description='URL of the user thumbnail'
          @value={{this.src}}
          @onInput={{this.setSrc}}
        />
        <Args.String
          @name='hue'
          @description='Override the name-derived hue; sets --pretui-chip-hue, and stays set when the caller also passes a style attribute (Pretui addition).'
          @options={{HUE_OPTIONS}}
          @value={{this.hue}}
          @onInput={{this.setHue}}
        />
        <Args.Number
          @name='size'
          @description='Avatar diameter in px at a 16px root, written as rem; sets the width, height and font size, and stays set when the caller also passes a style attribute (Pretui addition).'
          @defaultValue={{24}}
          @value={{this.size}}
          @min={{16}}
          @max={{96}}
          @step={{4}}
          @onInput={{this.setSize}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-avatar-size'
          @type='dimension'
          @description='Diameter for an Avatar with no @size; the font size is 0.42 of it. Give it a rem, px or container-query length: em and % do not keep that ratio. Set on the Avatar or any ancestor, through a class or a container query; @size wins over it.'
          @defaultValue='1.5rem'
        />
        <Css.Basic
          @name='pretui-chip-hue'
          @type='color'
          @description='Colour the fill, initials and hairline are mixed from. Set per instance to one of --chart-1 to --chart-5 from the name hash, or through @hue; a value in the caller style wins over the name hash. Falls back to --primary when @hue is rejected.'
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}

export const DEMOS_AVATAR: Record<string, unknown> = {
  Avatar: AvatarUsage,
};
