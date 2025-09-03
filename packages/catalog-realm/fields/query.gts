import {
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { AbsoluteCodeRefField } from 'https://cardstack.com/base/code-ref';
import type { Spec } from 'https://cardstack.com/base/spec';
import type { Query } from '@cardstack/runtime-common';
import { chooseCard, specRef } from '@cardstack/runtime-common';
import { FieldContainer, Button } from '@cardstack/boxel-ui/components';
import { resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { task } from 'ember-concurrency';

class QueryState {
  @tracked query?: Query = undefined;
  @tracked isLoading = false;
  @tracked error?: Error = undefined;

  get value(): Query | undefined {
    return this.query;
  }

  get isError(): boolean {
    return Boolean(this.error);
  }

  updateQuery(query: Query) {
    this.query = query;
    this.error = undefined;
  }

  setError(error: Error) {
    this.error = error;
    this.query = undefined;
  }
}

export function queryBuilderResource(
  parent: object,
  getType: () => { module?: string; name?: string } | null | undefined,
): QueryState {
  return resource(parent, () => {
    const state = new QueryState();

    const typeRef = getType();
    if (!typeRef?.module && !typeRef?.name) {
      state.setError(new Error('Query not setup. Please assign a type.'));
      return state;
    }
    if (typeRef?.module && typeRef?.name) {
      state.updateQuery({
        filter: {
          type: {
            module: typeRef.module,
            name: typeRef.name,
          },
        },
      });
    }

    return state;
  });
}

export class QueryTypeField extends FieldDef {
  static displayName = 'Query Type';

  @field codeRef = contains(AbsoluteCodeRefField); //we create nesting bcos we only can set field from outside itself

  // I don't know why the click event is leaking out of the button
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='container'>
        <div class='display'>
          {{#if @model.codeRef}}
            <div class='key-value'>
              <span class='key'>Module:</span>
              <span class='value'>{{@model.codeRef.module}}</span>
            </div>
            <div class='key-value'>
              <span class='key'>Name:</span>
              <span class='value'>{{@model.codeRef.name}}</span>
            </div>
          {{else}}
            <span class='placeholder'>No type selected</span>
          {{/if}}
        </div>
        <Button
          @kind='secondary'
          @size='small'
          {{on 'click' this.onChooseCard}}
        >
          Choose Card
        </Button>
      </div>

      <style scoped>
        .container {
          display: flex;
          gap: var(--boxel-sp);
          align-items: center;
        }

        .display {
          flex: 1;
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--boxel-300);
          border-radius: var(--boxel-border-radius);
        }

        .key-value {
          display: flex;
          gap: var(--boxel-sp-xs);
          margin-bottom: var(--boxel-sp-4xs);
        }

        .key {
          font-weight: 600;
          min-width: 60px;
          color: var(--boxel-600);
        }

        .value {
          flex: 1;
          word-break: break-all;
        }

        .placeholder {
          color: var(--boxel-500);
          font-style: italic;
        }
      </style>
    </template>

    onChooseCard = () => {
      this.chooseCardTask.perform();
    };

    private chooseCardTask = task(async () => {
      let specId = await chooseCard({
        filter: { type: specRef },
      });
      if (specId) {
        try {
          // Get the spec instance from the store via context
          let specInstance = (await this.args.context?.store?.get(
            specId,
          )) as Spec;
          if (specInstance && specInstance.ref) {
            this.args.model.codeRef = specInstance.ref;
          }
        } catch (error) {
          throw new Error('Failed to load the selected spec instance.');
        }
      }
    });
  };
}

export class QueryField extends FieldDef {
  static displayName = 'Query';

  @field type = contains(QueryTypeField);

  static edit = class Edit extends Component<typeof this> {
    queryBuilder = queryBuilderResource(
      this,
      () => this.args.model.type?.codeRef,
    );

    <template>
      <FieldContainer @vertical={{true}} @label='Query Type' @tag='label'>
        <@fields.type />
      </FieldContainer>

      <FieldContainer @vertical={{true}} @label='Query Builder' @tag='div'>
        {{#if this.queryBuilder.isError}}
          <div class='error-state'>
            Error:
            {{this.queryBuilder.error.message}}
          </div>
        {{else if this.queryBuilder.isLoading}}
          <div>
            Loading query...
          </div>
        {{else}}
          <div class='query-builder'>
            <!-- Query builder interface will go here -->
          </div>
        {{/if}}
      </FieldContainer>

      <FieldContainer @vertical={{true}} @label='Display Query' @tag='div'>
        {{#if this.queryBuilder.isError}}
          <div class='error-state'>
            Error:
            {{this.queryBuilder.error.message}}
          </div>
        {{else}}
          <pre class='query-display'>{{this.formattedQuery}}</pre>
        {{/if}}
      </FieldContainer>

      <style scoped>
        .query-builder {
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--boxel-300);
          border-radius: var(--boxel-border-radius);
          min-height: 100px;
        }

        .query-display {
          background: var(--boxel-100);
          padding: var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius);
          font-size: var(--boxel-font-sm);
          font-family: monospace;
          white-space: pre-wrap;
          overflow-x: auto;
        }
      </style>
    </template>

    get formattedQuery() {
      return JSON.stringify(this.queryBuilder.value, null, 2);
    }
  };
}
