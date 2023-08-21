export declare type TemplateMatch = TemplateTagMatch | TemplateLiteralMatch;
export interface TemplateTagMatch {
  type: 'template-tag';
  start: RegExpMatchArray;
  end: RegExpMatchArray;
}
export interface TemplateLiteralMatch {
  type: 'template-literal';
  tagName: string;
  start: RegExpMatchArray;
  end: RegExpMatchArray;
}
/**
 * Parses a template to find all possible valid matches for an embedded template.
 * Supported syntaxes are template literals:
 *
 *   hbs`Hello, world!`
 *
 * And template tags
 *
 *   <template></template>
 *
 * The parser excludes any values found within strings recursively, and also
 * excludes any string literals with dynamic segments (e.g `${}`) since these
 * cannot be valid templates.
 *
 * @param template The template to parse
 * @param relativePath Relative file path for the template (for errors)
 * @param templateTag Optional template tag if parsing template tags is enabled
 * @returns
 */
export declare function parseTemplates(
  template: string,
  relativePath: string,
  templateTag?: string,
): TemplateMatch[];
