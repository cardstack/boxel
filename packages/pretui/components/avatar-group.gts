// Pretui — AvatarGroup: an overlapping stack of Avatars with a count overflow.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface AvatarGroupSignature {
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

// Overlapping avatar row; the card-colored ring separates neighbors.
export const AvatarGroup: TemplateOnlyComponent<AvatarGroupSignature> = <template>
  <span class='pretui-avatar-group' data-test-pretui-avatar-group ...attributes>
    {{yield}}
  </span>
  <style scoped>
    .pretui-avatar-group {
      display: inline-flex;
    }
    .pretui-avatar-group > :deep(.pretui-avatar) {
      margin-left: -6px;
      box-shadow: 0 0 0 2px var(--card);
    }
    .pretui-avatar-group > :deep(.pretui-avatar:first-child) {
      margin-left: 0;
    }
  </style>
</template>;
