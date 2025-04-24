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
    importPath: string;
    importIdentifier: string;
}
/**
 * Represents a static import of a template literal.
 */
export interface StaticImportConfig {
    /**
     * The path to the package from which we want to import the template literal
     * (e.g.: 'ember-cli-htmlbars')
     */
    importPath: string;
    /**
     * The name of the template literal (e.g.: 'hbs') or 'default' if this package
     * exports a default function
     */
    importIdentifier: string;
}
/**
 * The input options to instruct parseTemplates on how to parse the input.
 *
 * @param templateTag
 * @param templateLiteral
 */
export interface ParseTemplatesOptions {
    /** Tag to use, if parsing template tags is enabled. */
    templateTag?: string;
    /** Which static imports are expected in this template. */
    templateLiteral?: StaticImportConfig[];
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
 * @param options optional configuration options for how to parse templates
 * @returns
 */
export declare function parseTemplates(template: string, relativePath: string, options?: ParseTemplatesOptions): TemplateMatch[];
