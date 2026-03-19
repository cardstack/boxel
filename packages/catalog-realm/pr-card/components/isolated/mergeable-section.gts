import GlimmerComponent from '@glimmer/component';
import TriangleAlertIcon from '@cardstack/boxel-icons/triangle-alert';
import CircleCheckIcon from '@cardstack/boxel-icons/circle-check';

interface MergeableSectionSignature {
  Args: {
    isMergeable: boolean;
    isClosedOrMerged: boolean;
    blockReasons: string[];
  };
}

export class MergeableSection extends GlimmerComponent<MergeableSectionSignature> {
  <template>
    {{#unless @isClosedOrMerged}}
      {{#if @isMergeable}}
        <div class='mergeable-banner mergeable-banner--ok'>
          <span class='mergeable-icon-wrap mergeable-icon-wrap--ok'>
            <CircleCheckIcon class='mergeable-icon' />
          </span>
          <div class='mergeable-content'>
            <span class='mergeable-title'>Ready to merge</span>
            <span class='mergeable-subtitle'>All merge requirements have been
              met</span>
          </div>
        </div>
      {{else}}
        <div class='mergeable-banner mergeable-banner--blocked'>
          <span class='mergeable-icon-wrap mergeable-icon-wrap--blocked'>
            <TriangleAlertIcon class='mergeable-icon' />
          </span>
          <div class='mergeable-content'>
            <span class='mergeable-title'>Merging is blocked</span>
            {{#each @blockReasons as |reason|}}
              <span class='mergeable-reason'>{{reason}}</span>
            {{/each}}
          </div>
        </div>
      {{/if}}
    {{/unless}}

    <style scoped>
      .mergeable-banner {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        border-top: 1px solid var(--border, var(--boxel-border-color));
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
      }
      .mergeable-banner--blocked {
        background: color-mix(
          in srgb,
          var(--destructive, #d73a49) 5%,
          var(--card, #ffffff)
        );
      }
      .mergeable-banner--ok {
        background: color-mix(
          in srgb,
          var(--chart-1, #28a745) 5%,
          var(--card, #ffffff)
        );
      }
      .mergeable-icon-wrap {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .mergeable-icon-wrap--blocked {
        background: var(--destructive, #d73a49);
      }
      .mergeable-icon-wrap--ok {
        background: var(--chart-1, #28a745);
      }
      .mergeable-icon {
        width: 16px;
        height: 16px;
        color: #ffffff;
      }
      .mergeable-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .mergeable-title {
        font-size: var(--boxel-font-sm);
        font-weight: 700;
        color: var(--foreground, #1f2328);
        line-height: 1.4;
      }
      .mergeable-reason,
      .mergeable-subtitle {
        font-size: var(--boxel-font-sm);
        color: var(--muted-foreground, #656d76);
        line-height: 1.5;
      }
    </style>
  </template>
}
