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
    <div class='FreestyleUsage' ...attributes>
      {{! identity lives in the page header (breadcrumb) — no h2 here; one
          compact description line, then straight to the artboard }}
      {{#if (has-block 'description')}}
        <p class='FreestyleUsage-description'>{{yield to='description'}}</p>
      {{else if @description}}
        <p class='FreestyleUsage-description'>{{@description}}</p>
      {{/if}}

      <div class='FreestyleUsage-stage'>
        <div class='FreestyleUsage-previewCol'>
          <div class='wb-panel'>
            <Viewport @defaultMode={{@viewportMode}} @label={{@name}}>
              {{yield to='example'}}
            </Viewport>
            {{#if @source}}
              <div class='wb-codestrip'>
                <code class='wb-code'>{{@source}}</code>
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
          <aside class='FreestyleUsage-props'>
            <h3 class='FreestyleUsage-sectionTitle'>Properties</h3>
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
        <div class='FreestyleUsage-api wb-panel'>
          <div class='wb-panel-h'>
            <h3 class='FreestyleUsage-sectionTitle wb-cap'>API</h3>
          </div>
          <Table>
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
        <div class='FreestyleUsage-api wb-panel'>
          <div class='wb-panel-h'>
            <h3 class='FreestyleUsage-sectionTitle wb-cap'>CSS Variables</h3>
          </div>
          <Table>
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
      .FreestyleUsage {
        display: grid;
        gap: var(--space-3, 8px);
        align-content: start;
        min-width: 0;
        max-width: 100%;
      }
      .FreestyleUsage-description {
        margin: 0;
        max-width: 78ch;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
        line-height: 1.5;
      }
      .FreestyleUsage-stage {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px;
        gap: var(--space-5, 14px);
        align-items: start;
      }
      @media (max-width: 900px) {
        .FreestyleUsage-stage {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .FreestyleUsage-previewCol {
        display: grid;
        gap: var(--space-3, 8px);
        min-width: 0;
      }
      /* workbench panel chrome: bordered card, header row, clipped body */
      .wb-panel {
        background: var(--card);
        border-radius: 6px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        overflow: hidden;
        min-width: 0;
      }
      .wb-panel-h {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 36px;
        padding: 8px var(--space-4, 11px);
        box-shadow: inset 0 -1px 0 var(--border);
      }
      h3.wb-cap {
        margin: 0;
      }
      .wb-th-right {
        text-align: right;
      }
      .wb-codestrip {
        display: flex;
        align-items: center;
        gap: var(--space-4, 11px);
        padding: 6px var(--space-4, 11px);
        box-shadow: inset 0 1px 0 var(--border);
        background: var(--card);
        overflow-x: auto;
      }
      .wb-code {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        white-space: pre;
        flex: 1;
      }
      .wb-codestrip > :last-child {
        flex: none;
        margin-left: auto;
      }
      .FreestyleUsage-props {
        background: var(--card);
        border-radius: 6px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        padding: var(--space-4, 11px) var(--space-5, 14px) var(--space-5, 14px);
        min-width: 0;
        align-self: start;
        position: sticky;
        top: 52px;
      }
      /* THE caps treatment — panel and group headers only */
      .FreestyleUsage-sectionTitle {
        margin: 0 0 var(--space-3, 8px);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .FreestyleUsage-api {
        min-width: 0;
      }
      .FreestyleUsage-source {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        background: var(--inset, var(--boxel-100));
        border-radius: var(--radius);
        box-shadow: inset 0 0 0 1px var(--border);
        padding: var(--space-4, 11px);
        overflow-x: auto;
      }
    </style>
  </template>;
