import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { Accordion, Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import StatusIndicator from './status-indicator';
import { getComponent } from 'https://cardstack.com/base/card-api';
import type { WorkflowStepInterface } from '../card-generation/workflow-step';
import type { Format } from '@cardstack/runtime-common';
import type { BoxComponent } from 'https://cardstack.com/base/card-api';

interface AccordionWorkflowSignature {
  Args: {
    steps?: WorkflowStepInterface<any>[];
    onRunStep?: (stepId: string) => void;
    openStepId?: string | null;
    onOpenAccordion?: (stepId: string | null) => void;
  };
  Element: HTMLElement;
}

export default class AccordionWorkflow extends GlimmerComponent<AccordionWorkflowSignature> {
  @tracked private _selectedSpecId: string | null | undefined;

  get steps(): WorkflowStepInterface<any>[] {
    return this.args.steps ?? [];
  }

  get resolvedOpenStepId(): string | null {
    if (this.args.openStepId !== undefined) {
      return this.args.openStepId ?? null;
    }
    if (this._selectedSpecId !== undefined) {
      return this._selectedSpecId;
    }
    let active =
      this.steps.find((step) => step.state === 'pending') ??
      this.steps.find((step) => step.state === 'idle');
    return active?.id ?? this.steps[0]?.id ?? null;
  }

  handleToggle = (stepId: string): void => {
    let next = this.resolvedOpenStepId === stepId ? null : stepId ?? null;
    this.setSelectedStep(next);
  };

  handleRunStep = (step: WorkflowStepInterface<any>, event?: Event): void => {
    event?.stopPropagation();
    this.setSelectedStep(step.id);
    this.args.onRunStep?.(step.id);
  };

  hasResult = (step: WorkflowStepInterface<any>): boolean => {
    return step.value != null || step.error != null;
  };

  itemClass(step: WorkflowStepInterface<any>): string {
    let state = step.state ?? 'idle';
    return `workflow-steps__item workflow-steps__item--${state}`;
  }

  private setSelectedStep(stepId: string | null): void {
    if (this.args.onOpenAccordion) {
      this.args.onOpenAccordion(stepId);
    } else {
      this._selectedSpecId = stepId ?? null;
    }
  }

  formatResult = (
    step: WorkflowStepInterface<any>,
  ): {
    component: BoxComponent;
    format: Format | undefined;
    result: unknown;
  } | null => {
    let result = step.value;
    if (!result || result instanceof Error) {
      return null;
    }
    let CardComponent = getComponent(result);
    if (!CardComponent) {
      return null;
    }
    return {
      component: CardComponent,
      format: step.format,
      result: result,
    };
  };

  <template>
    <Accordion class='workflow-steps' as |A|>
      {{#each this.steps as |step|}}
        <A.Item
          @onClick={{fn this.handleToggle step.id}}
          @isOpen={{eq this.resolvedOpenStepId step.id}}
          @className={{this.itemClass step}}
          @contentClass='workflow-steps__panel'
          data-test-workflow-step={{step.id}}
        >
          <:title>
            <div class='workflow-steps__toggle'>
              <StatusIndicator @state={{step.state}} />
              <div class='workflow-steps__title'>
                <span class='workflow-steps__label'>
                  {{step.label}}
                </span>
                {{#if step.commandRef}}
                  <span class='workflow-steps__command'>
                    {{step.commandRef.module}}/{{step.commandRef.name}}
                  </span>
                {{/if}}
                <span class='workflow-steps__description'>
                  {{step.description}}
                </span>
              </div>
              <div class='workflow-steps__action'>
                <Button
                  @kind='secondary-light'
                  @size='small'
                  @loading={{step.isLoading}}
                  @disabled={{step.isLoading}}
                  {{on 'click' (fn this.handleRunStep step)}}
                >
                  {{#if step.isLoading}}
                    Running…
                  {{else}}
                    {{if (this.hasResult step) 'Re-run' 'Run'}}
                  {{/if}}
                </Button>
              </div>
            </div>
          </:title>
          <:content>
            {{#let (this.formatResult step) as |formatted|}}
              {{#if step.error}}
                <p class='workflow-steps__error'>
                  {{step.error.message}}
                </p>
              {{else if formatted}}
                <formatted.component @format='isolated' />
              {{else}}
                <p class='workflow-steps__placeholder'>
                  Execution not yet triggered.
                </p>
              {{/if}}
            {{/let}}
          </:content>
        </A.Item>
      {{/each}}
    </Accordion>

    <style scoped>
      .workflow-steps {
        --accordion-background-color: var(--boxel-0);
        --accordion-border: 1px solid var(--boxel-200);
        --accordion-border-radius: var(--boxel-border-radius);

        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }

      .workflow-steps.accordion {
        border: none;
        background: transparent;
        gap: var(--boxel-sp-sm);
      }

      :deep(.workflow-steps__item) {
        --accordion-item-closed-height: auto;
        --accordion-item-open-height: auto;

        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-0);
        transition: background var(--boxel-transition);
      }

      :deep(.workflow-steps__item.open) {
        height: auto;
      }

      :deep(.workflow-steps__item .title) {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        width: 100%;
      }

      :deep(.workflow-steps__item--idle) {
        border-color: var(--boxel-200);
        background: var(--boxel-0);
      }

      :deep(.workflow-steps__item--pending) {
        border-color: var(--boxel-purple-400);
        background: var(--boxel-purple-50, rgba(127, 86, 217, 0.08));
      }

      :deep(.workflow-steps__item--success) {
        border-color: var(--boxel-success-200);
        background: var(--boxel-light-200);
      }

      :deep(.workflow-steps__item--error) {
        border-color: var(--boxel-danger);
        background: rgba(255, 0, 0, 0.08);
      }

      .workflow-steps__toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp);
        flex: 1;
        min-width: 0;
      }

      .workflow-steps__action {
        margin-right: var(--boxel-sp-xs);
      }

      .workflow-steps__title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
      }

      :deep(.workflow-steps__panel) {
        padding: 0 var(--boxel-sp-lg) var(--boxel-sp-lg)
          calc(var(--boxel-sp-lg) + 1.75rem);
      }

      :deep(.workflow-steps__item.open .workflow-steps__panel) {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }

      .workflow-steps__label {
        font-weight: 600;
        color: var(--boxel-700);
      }

      .workflow-steps__command {
        margin: 0;
        color: var(--boxel-500);
        font-weight: 400;
        font-size: var(--boxel-font-size-xs);
        font-family: var(--boxel-font-family-mono, monospace);
      }

      .workflow-steps__description {
        margin: 0;
        color: var(--boxel-600);
        font-weight: 400;
        font-size: var(--boxel-font-size-sm);
      }

      .workflow-steps__error {
        color: var(--boxel-danger);
        margin: 0;
      }

      .workflow-steps__placeholder {
        color: var(--boxel-500);
        font-size: var(--boxel-font-size-sm);
        font-style: italic;
        text-align: center;
        padding: var(--boxel-sp-lg);
        background: var(--boxel-100);
        border-radius: var(--boxel-border-radius-sm);
        margin: 0;
      }
    </style>
  </template>
}
