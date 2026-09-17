import { baseCardRef, type CodeRef } from './index.ts';
import type { Definition } from './definitions.ts';
import type { Filter } from './query.ts';
import { any, every, param, type Expression } from './expression.ts';

// Only the admitted native producer supplies this evidence. These values come
// from the source and cannot change when another input's computed value changes.
// Keep the initial vocabulary small: other codecs/paths stay conservative.
export function latticeSourceFields(definition: Definition) {
  const fields: Record<string, 'string' | 'strings'> = {};
  for (const [name, key] of Object.entries(definition.fields)) {
    const field = definition.fieldDefs[key];
    if (
      name !== 'id' &&
      name !== 'url' &&
      field?.isPrimitive &&
      !field.isComputed &&
      !field.query &&
      !field.searchable &&
      !field.serializerName &&
      field.nativeCodec?.kind === 'primitive' &&
      field.nativeCodec.scalar === 'string' &&
      !field.nativeCodec.serializer &&
      (field.type === 'contains' || field.type === 'containsMany')
    )
      fields[name] = field.type === 'contains' ? 'string' : 'strings';
  }
  return fields;
}

// A necessary condition, not an alternate query evaluator. Retain the ordinary
// query's exact membership/watch. Unknown predicates are TRUE here; in an OR
// they keep the whole branch possible. Never narrow on a computed old value.
// `i` is the indexed input row. Its code must be current before its source-field
// evidence can exclude it. Both the frontier and admission use this expression.
export async function latticeQueryReadinessScope(
  filter: Filter | undefined,
  typeScope: (filter: Filter | undefined) => Promise<Expression>,
  codeCurrent: Expression,
  sourceFields: (ref: CodeRef) => Promise<Record<string, 'string' | 'strings'>>,
  on: CodeRef = baseCardRef,
): Promise<Expression> {
  const scope = await typeScope(filter);
  if (filter && 'on' in filter && filter.on) on = filter.on;
  if (!filter || 'not' in filter) return scope;
  if ('every' in filter || 'any' in filter) {
    const children = await Promise.all(
      ('every' in filter ? filter.every : filter.any).map((child) =>
        latticeQueryReadinessScope(
          child,
          typeScope,
          codeCurrent,
          sourceFields,
          on,
        ),
      ),
    );
    return every([
      scope,
      'every' in filter ? every(children) : any(children),
    ]) as Expression;
  }
  const values = 'eq' in filter ? filter.eq : 'in' in filter ? filter.in : {};
  const predicates: Expression[] = [scope];
  const allowed = Object.keys(values).length ? await sourceFields(on) : {};
  for (const [field, raw] of Object.entries(values)) {
    // Dotted paths, relationships, null semantics and non-string codecs need
    // their own proofs. Ignoring them costs scheduling precision, not answers.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) || !allowed[field]) continue;
    const candidates = 'in' in filter ? raw : [raw];
    if (
      !Array.isArray(candidates) ||
      candidates.length === 0 ||
      !candidates.every((value) => typeof value === 'string')
    )
      continue;
    const contains = (plural: boolean): Expression =>
      any(
        candidates.map(
          (value): Expression => [
            {
              kind: 'json-contains',
              column: 'i.search_doc',
              segments: [field],
              ...(plural ? { arraySegments: [0] } : {}),
              value: param(value),
            },
          ],
        ),
      ) as Expression;
    const proof: Expression = [
      ...codeCurrent,
      `AND i.pristine_doc->'meta'->'publication'->>'version' = '1'
       AND jsonb_typeof(i.pristine_doc->'meta'->'publication'->'computedFields') = 'array'
       AND jsonb_typeof(i.pristine_doc->'meta'->'publication'->'queryFields') = 'array'
       AND NOT (i.pristine_doc->'meta'->'publication'->'computedFields' ?`,
      param(field),
      `) AND NOT (i.pristine_doc->'meta'->'publication'->'queryFields' ?`,
      param(field),
      ') AND i.search_doc ?',
      param(field),
    ];
    predicates.push([
      'CASE WHEN (',
      ...proof,
      `) AND i.pristine_doc->'meta'->'publication'->'sourceFields'->>`,
      param(field),
      '=',
      param(allowed[field]),
      'THEN',
      ...contains(allowed[field] === 'strings'),
      'ELSE TRUE END',
    ]);
  }
  return every(predicates) as Expression;
}
