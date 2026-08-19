import {
  buildToolFunctionNameFromResolvedRef,
  codeRefWithAbsoluteIdentifier,
  getClass,
  rri,
  type Loader,
  type ResolvedCodeRef,
  type ToolContext,
  type ToolSchemaError,
} from '@cardstack/runtime-common';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import * as CardAPI from './card-api';
import {
  Component,
  field,
  contains,
  containsMany,
  type BaseDefComponent,
} from './card-api';
import StringField from './string';
import {
  FrontmatterField,
  type FromFrontmatterContext,
  type FromFrontmatterResult,
} from './frontmatter-field';
import { ToolField } from './tool-field';

import type { Tool as LLMTool } from './matrix-event';

// A skill markdown file's frontmatter (`boxel.kind: skill`). Adds typed fields
// on top of the base `FrontmatterField` (which holds the raw frontmatter in
// `rawContent`). Mirrors the field shape of the legacy `Skill` card so the
// host's tool-definition upload flow reads `markdownDef.frontmatter.tools`
// exactly as it reads `Skill.commands`. `name`/`description` are sourced from the
// shared top-level frontmatter keys (see `MarkdownDef.extractAttributes`).
export class SkillFrontmatterField extends FrontmatterField {
  static displayName = 'Skill';

  @field name = contains(StringField);
  @field description = contains(StringField);
  @field tools = containsMany(ToolField);
  // Legacy spelling of `tools`. Index rows extracted before the
  // command -> tool rename persist the value under a `commands` attribute;
  // this field lets those rows rehydrate without a reindex. Consumers read
  // `tools` and fall back to this (see the host's `getSkillSourceTools`).
  // Remove once all realms have reindexed post-rename.
  @field commands = containsMany(ToolField);

  // `name`/`description` come from the shared top-level frontmatter keys;
  // `tools` from the `boxel:` namespace (`boxel.tools`, with the pre-rename
  // `boxel.commands` key still accepted; `tools` wins when both are present).
  // Only this subclass knows that mapping.
  //
  // When the context carries a `toolContext` (the indexing path), each tool
  // additionally gets its LLM tool definition generated and stamped — with
  // the resolved absolute codeRef, functionName, and normalized
  // requiresApproval — into `fileMetaAttributes`, so consumers (ai-bot
  // first) obtain ready-to-use tool definitions from the index without a
  // module loader. The search-doc `attributes` keep the tools as authored.
  static async fromFrontmatter(
    frontmatter: Record<string, unknown>,
    context?: FromFrontmatterContext,
  ): Promise<FromFrontmatterResult> {
    let { attributes: base } = await super.fromFrontmatter(
      frontmatter,
      context,
    );
    let boxel =
      frontmatter.boxel &&
      typeof frontmatter.boxel === 'object' &&
      !Array.isArray(frontmatter.boxel)
        ? (frontmatter.boxel as Record<string, unknown>)
        : undefined;
    let authored = boxel?.tools ?? boxel?.commands;
    let attributes = {
      ...base,
      name: frontmatter.name,
      description: frontmatter.description,
      tools: authored,
    };
    if (
      !context?.toolContext ||
      !Array.isArray(authored) ||
      authored.length === 0
    ) {
      return { attributes };
    }
    let enrichment: Awaited<ReturnType<typeof generateToolDefinitions>>;
    try {
      enrichment = await generateToolDefinitions(
        authored as Record<string, any>[],
        context.fileURL,
        context.toolContext,
      );
    } catch (err) {
      // Schema generation must never fail the file row — the skill still
      // indexes with its tools as authored. Failures inside the generation
      // are already attributed per tool; anything reaching here is a bug in
      // the generation code itself.
      console.warn(
        `[skill-frontmatter] tool schema generation failed for ${context.fileURL}:`,
        err,
      );
      return { attributes };
    }
    let { tools, toolSchemaErrors } = enrichment;
    return {
      attributes,
      fileMetaAttributes: { ...attributes, tools },
      // Only this subclass knows the diagnostics key its findings live
      // under; the plumbing back to the indexed row is kind-agnostic.
      ...(toolSchemaErrors.length ? { diagnostics: { toolSchemaErrors } } : {}),
    };
  }

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>{{@model.name}}</template>
  };
}

// Generate each authored tool's LLM tool definition. A tool that fails
// (module won't load, missing export, schema generation throws) stays in the
// returned list as authored and contributes a `ToolSchemaError`; the
// remaining tools still enrich.
//
// Loading realm-hosted tool modules through the loader also records them as
// runtime dependencies of the surrounding extract, so editing such a module
// reindexes the referencing skill. Host-package tool modules
// (`@cardstack/boxel-host/...`) resolve inside the host bundle and don't
// participate in invalidation — their stamped schemas can go stale across
// host deploys until the skill's realm reindexes.
async function generateToolDefinitions(
  authoredTools: Record<string, any>[],
  fileURL: string,
  toolContext: ToolContext,
): Promise<{
  tools: Record<string, any>[];
  toolSchemaErrors: ToolSchemaError[];
}> {
  // The authored coordinates, coerced once — used both to validate an entry
  // and to name it in an error.
  let coordinatesOf = (entry: Record<string, any>) => ({
    module:
      typeof entry?.codeRef?.module === 'string' ? entry.codeRef.module : '',
    name: typeof entry?.codeRef?.name === 'string' ? entry.codeRef.name : '',
  });

  let loader = myLoader();
  let mappings: Awaited<ReturnType<typeof basicMappings>>;
  try {
    mappings = await basicMappings(loader);
  } catch (err) {
    // Setup failed before any tool could be attempted (e.g. a transient
    // failure loading the base field modules). Attribute the failure to
    // every declared tool so the diagnostics name real coordinates instead
    // of a single anonymous entry.
    console.warn(
      `[skill-frontmatter] tool schema generation failed for ${fileURL}:`,
      err,
    );
    let message = `tool schema generation failed before this tool was attempted: ${
      err instanceof Error ? err.message : String(err)
    }`;
    return {
      tools: authoredTools,
      toolSchemaErrors: authoredTools.map((entry) => ({
        ...coordinatesOf(entry),
        message,
      })),
    };
  }

  let skillURL = new URL(fileURL);
  // Tools are independent; the loader dedupes concurrent module imports, so
  // enriching in parallel overlaps the per-tool module fetches.
  let results = await Promise.all(
    authoredTools.map(
      async (
        entry,
      ): Promise<{
        entry: Record<string, any>;
        error?: ToolSchemaError;
      }> => {
        let { module, name } = coordinatesOf(entry);
        if (!module || !name) {
          return {
            entry,
            error: {
              module,
              name,
              message: 'tool entry is missing a codeRef module/name',
            },
          };
        }
        // Resolve in RRI space (no VirtualNetwork), matching how ToolField
        // computes `functionName` — so the stamped name and a host-side
        // recomputation from the stamped codeRef always agree. Package
        // specifiers pass through verbatim.
        let resolvedRef = codeRefWithAbsoluteIdentifier(
          { module: rri(module), name },
          skillURL,
          undefined,
        ) as ResolvedCodeRef;
        try {
          let ToolClass = await getClass(resolvedRef, loader);
          if (typeof ToolClass !== 'function') {
            throw new Error(
              `module does not export a tool class named "${resolvedRef.name}"`,
            );
          }
          let tool = new ToolClass(toolContext);
          let functionName = buildToolFunctionNameFromResolvedRef(resolvedRef);
          let definition = {
            type: 'function' as LLMTool['type'],
            function: {
              name: functionName,
              description: tool.description,
              parameters: {
                type: 'object',
                properties: {
                  description: {
                    type: 'string',
                  },
                  ...(await tool.getInputJsonSchema(CardAPI, mappings)),
                },
                required: ['attributes', 'description'],
              },
            },
          };
          return {
            entry: {
              ...entry,
              codeRef: resolvedRef,
              // Absent means "requires approval"; stamp that decision so
              // consumers don't each re-implement the default.
              requiresApproval: entry.requiresApproval !== false,
              functionName,
              definition,
            },
          };
        } catch (err) {
          console.warn(
            `[skill-frontmatter] tool schema generation failed for ${resolvedRef.module}#${resolvedRef.name} (skill ${fileURL}):`,
            err,
          );
          return {
            entry,
            error: {
              module: resolvedRef.module,
              name: resolvedRef.name,
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      },
    ),
  );
  return {
    tools: results.map((result) => result.entry),
    toolSchemaErrors: results.flatMap((result) =>
      result.error ? [result.error] : [],
    ),
  };
}

function myLoader(): Loader {
  // we know this code is always loaded by an instance of our Loader, which
  // sets import.meta.loader.

  // When type-checking realm-server, tsc sees this file and thinks it will be
  // transpiled to CommonJS and so it complains about this line. But this file
  // is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return (import.meta as any).loader;
}
