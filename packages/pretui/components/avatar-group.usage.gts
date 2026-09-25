// Pretui — AvatarGroup usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from '../freestyle';
import { Avatar } from './avatar';
import { AvatarGroup } from './avatar-group';

const PEOPLE = [
  { name: 'Mei-Lin Chua', hue: 'var(--chart-1)' },
  { name: 'Tomás Aravena', hue: 'var(--chart-2)' },
  { name: 'Priya Raghunathan', hue: 'var(--chart-3)' },
  { name: 'Kwame Boateng', hue: 'var(--chart-4)' },
];

class AvatarGroupUsage extends Component {
  people = PEOPLE;
  <template>
    <FreestyleUsage
      @name='AvatarGroup'
      @description='A compact overlap for named people. Every Avatar retains its own accessible name; the card-coloured ring separates neighbours without adding a new hue.'
      @source='<AvatarGroup><Avatar @name="Mei-Lin Chua" />…</AvatarGroup>'
    >
      <:example>
        <AvatarGroup>
          {{#each this.people as |person|}}
            <Avatar @name={{person.name}} @hue={{person.hue}} @size={{32}} />
          {{/each}}
        </AvatarGroup>
      </:example>
      <:api as |Args|>
        <Args.Yield @name='default' @description='Avatar children in display order.' />
        <Args.Object @name='sample people' @value={{this.people}} @description='Representative fixture data for the yielded Avatars.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_AVATAR_GROUP: Record<string, unknown> = {
  AvatarGroup: AvatarGroupUsage,
};
