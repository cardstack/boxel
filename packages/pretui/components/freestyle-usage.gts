// Pretui — FreestyleUsage: a component's usage page — example, knobs and API table.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { Table } from './table';
import { CopyButton } from './copy-button';
import { UsageAction } from './usage-action';
import { UsageArgument } from './usage-argument';
import { UsageArray } from './usage-array';
import { UsageBool } from './usage-bool';
import { UsageComponentArg } from './usage-component-arg';
import { UsageCssVariable } from './usage-css-variable';
import { UsageNumber } from './usage-number';
import { UsageObject } from './usage-object';
import { UsageString } from './usage-string';
import { UsageYield } from './usage-yield';
import { Viewport } from './viewport';

// ── FreestyleUsage (the page) ────────────────────────────────────────────
export interface FreestyleUsageSignature {
  Args: {
    name?: string;
    description?: string;
    slug?: string;
    source?: string;
    viewportMode?: 'fill' | 'narrow' | 'wide' | 'inline' | 'grid';
  };
  Blocks: {
    description: [];
    example: [];
    /* eslint-disable @typescript-eslint/no-explicit-any -- the yielded Args
       hash is any-typed exactly as in ember-freestyle's own signature */
    api: [
      {
        Action: any;
        Array: any;
        Base: any;
        Bool: any;
        Component: any;
        Number: any;
        Object: any;
        String: any;
        Yield: any;
      },
    ];
    cssVars: [{ Basic: any }];
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
  Element: HTMLDivElement;
}

export const FreestyleUsage: TemplateOnlyComponent<FreestyleUsageSignature> =
  <template>
    <div class='pretui-usage' data-test-pretui-usage ...attributes>
      {{! identity lives in the page header (breadcrumb) — no h2 here; one
          compact description line, then straight to the artboard }}
      {{#if (has-block 'description')}}
        <p
          class='pretui-usage-description'
          data-test-pretui-usage-description
        >{{yield to='description'}}</p>
      {{else if @description}}
        <p
          class='pretui-usage-description'
          data-test-pretui-usage-description
        >{{@description}}</p>
      {{/if}}

      <div class='pretui-usage-stage'>
        <div class='pretui-usage-preview-col'>
          <div class='wb-panel'>
            <Viewport @defaultMode={{@viewportMode}} @label={{@name}}>
              {{yield to='example'}}
            </Viewport>
            {{#if @source}}
              <div class='wb-codestrip' data-test-pretui-usage-source>
                <code
                  class='wb-code'
                  data-test-pretui-usage-source-code
                >{{@source}}</code>
                <CopyButton
                  @text={{@source}}
                  @label='Copy usage'
                  @variant='ghost'
                />
              </div>
            {{/if}}
          </div>
        </div>
        {{#if (has-block 'api')}}
          <aside
            class='pretui-usage-props wb-panel'
            data-test-pretui-usage-props
          >
            <h2
              class='pretui-usage-section-title'
              data-test-pretui-usage-section-title
            >Properties</h2>
            {{yield
              (hash
                Action=(component UsageAction mode='prop')
                Array=(component UsageArray mode='prop')
                Base=(component UsageArgument mode='prop')
                Bool=(component UsageBool mode='prop')
                Component=(component UsageComponentArg mode='prop')
                Number=(component UsageNumber mode='prop')
                Object=(component UsageObject mode='prop')
                String=(component UsageString mode='prop')
                Yield=(component UsageYield mode='prop')
              )
              to='api'
            }}
            {{#if (has-block 'cssVars')}}
              {{yield
                (hash Basic=(component UsageCssVariable mode='prop'))
                to='cssVars'
              }}
            {{/if}}
          </aside>
        {{/if}}
      </div>

      {{#if (has-block 'api')}}
        <div class='pretui-usage-api wb-panel' data-test-pretui-usage-api>
          <div class='wb-panel-h'>
            <h2
              class='pretui-usage-section-title wb-cap'
              data-test-pretui-usage-section-title
            >API</h2>
          </div>
          <Table @framed={{false}}>
            <:head>
              <tr>
                <th>Argument</th>
                <th>Type</th>
                <th>Description</th>
                <th class='wb-th-right'>Default</th>
              </tr>
            </:head>
            <:body>
              {{yield
                (hash
                  Action=(component UsageAction mode='doc')
                  Array=(component UsageArray mode='doc')
                  Base=(component UsageArgument mode='doc')
                  Bool=(component UsageBool mode='doc')
                  Component=(component UsageComponentArg mode='doc')
                  Number=(component UsageNumber mode='doc')
                  Object=(component UsageObject mode='doc')
                  String=(component UsageString mode='doc')
                  Yield=(component UsageYield mode='doc')
                )
                to='api'
              }}
            </:body>
          </Table>
        </div>
      {{/if}}

      {{#if (has-block 'cssVars')}}
        <div class='pretui-usage-api wb-panel' data-test-pretui-usage-css-vars>
          <div class='wb-panel-h'>
            <h2
              class='pretui-usage-section-title wb-cap'
              data-test-pretui-usage-section-title
            >CSS Variables</h2>
          </div>
          <Table @framed={{false}}>
            <:head>
              <tr>
                <th>Variable</th>
                <th>Type</th>
                <th>Description</th>
                <th class='wb-th-right'>Default</th>
              </tr>
            </:head>
            <:body>
              {{yield
                (hash Basic=(component UsageCssVariable mode='doc'))
                to='cssVars'
              }}
            </:body>
          </Table>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .pretui-usage {
        --pretui-usage-props-w: 22rem;
        --pretui-usage-panel-h: 2.25rem;
        --pretui-usage-description-max-w: 64rem;

        display: grid;
        gap: var(--boxel-sp-xs);
        align-content: start;
        min-width: 0;
        max-width: 100%;
      }
      .pretui-usage-description {
        max-inline-size: var(--pretui-usage-description-max-w);
        color: var(--muted-foreground);
      }
      /* the Properties rail wraps under the preview when the preview would
         drop below 60% of the row, so it needs no viewport or container
         query (a container would also capture the examples' fixed popups) */
      .pretui-usage-stage {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        /* the props panel is at least as tall as the preview beside it */
        align-items: stretch;
      }
      .pretui-usage-stage > .pretui-usage-preview-col {
        flex: 999 1 0;
        min-inline-size: 60%;
        align-self: start;
      }
      /* never narrower than its width: the row stacks first */
      .pretui-usage-stage > .pretui-usage-props {
        flex: 1 1 var(--pretui-usage-props-w);
        /* capped at the row, so a stacked panel on a narrow screen still fits */
        min-inline-size: min(var(--pretui-usage-props-w), 100%);
      }
      .pretui-usage-preview-col {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      /* workbench panel chrome: bordered card, header row, clipped body */
      .wb-panel {
        background-color: var(--card);
        color: var(--card-foreground);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 0 0 1px var(--border);
        overflow: hidden;
        min-width: 0;
      }
      .wb-panel-h {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-height: var(--pretui-usage-panel-h);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        box-shadow: inset 0 -1px 0 var(--border);
      }
      .wb-th-right {
        text-align: end;
      }
      .wb-codestrip {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
        box-shadow: inset 0 1px 0 var(--border);
        overflow-x: auto;
      }
      .wb-code {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        white-space: pre;
        flex: 1;
      }
      .wb-codestrip > :last-child {
        flex: none;
        margin-inline-start: auto;
      }
      /* a wb-panel that keeps its controls' focus rings and menus unclipped */
      .pretui-usage-props {
        padding: var(--boxel-sp-sm) var(--boxel-sp) var(--boxel-sp);
        overflow: visible;
      }
      /* THE caps treatment — panel and group headers only */
      .pretui-usage-section-title {
        margin-block-end: var(--boxel-sp-xs);
        font-family: var(--boxel-eyebrow-font-family);
        font-size: var(--boxel-eyebrow-font-size);
        font-weight: var(--boxel-eyebrow-font-weight);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .wb-cap {
        margin-block-end: 0;
      }
      .pretui-usage-api {
        min-width: 0;
      }
    </style>
  </template>;
