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
          @description='Override the name-derived hue (Pretui addition).'
          @options={{HUE_OPTIONS}}
          @value={{this.hue}}
          @onInput={{this.setHue}}
        />
        <Args.Number
          @name='size'
          @description='Avatar diameter in px (Pretui addition).'
          @defaultValue={{24}}
          @value={{this.size}}
          @min={{16}}
          @max={{96}}
          @step={{4}}
          @onInput={{this.setSize}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_AVATAR: Record<string, unknown> = {
  Avatar: AvatarUsage,
};
