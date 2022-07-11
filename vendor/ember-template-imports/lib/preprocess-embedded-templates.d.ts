interface PreprocessOptionsEager {
    getTemplateLocals: GetTemplateLocals;
    importIdentifier?: string;
    importPath?: string;
    templateTag?: string;
    templateTagReplacement?: string;
    relativePath: string;
    includeSourceMaps: boolean;
    includeTemplateTokens: boolean;
}
interface PreprocessOptionsLazy {
    getTemplateLocalsRequirePath: string;
    getTemplateLocalsExportPath: string;
    importIdentifier?: string;
    importPath?: string;
    templateTag?: string;
    templateTagReplacement?: string;
    relativePath: string;
    includeSourceMaps: boolean;
    includeTemplateTokens: boolean;
}
declare type PreprocessOptions = PreprocessOptionsLazy | PreprocessOptionsEager;
interface PreprocessedOutput {
    output: string;
    replacements: Replacement[];
}
interface Replacement {
    type: 'start' | 'end';
    index: number;
    oldLength: number;
    newLength: number;
    originalLine: number;
    originalCol: number;
}
declare type GetTemplateLocals = (template: string) => string[];
/**
 * Preprocesses all embedded templates within a JavaScript or TypeScript file.
 * This function replaces all embedded templates that match our template syntax
 * with valid, parseable JS. Optionally, it can also include a source map, and
 * it can also include all possible values used within the template.
 *
 * Input:
 *
 *   <template><MyComponent/><template>
 *
 * Output:
 *
 *   [GLIMMER_TEMPLATE(`<MyComponent/>`, { scope() { return {MyComponent}; } })];
 *
 * It can also be used with template literals to provide the in scope values:
 *
 * Input:
 *
 *   hbs`<MyComponent/>`;
 *
 * Output
 *
 *   hbs(`<MyComponent/>`, { scope() { return {MyComponent}; } });
 */
export declare function preprocessEmbeddedTemplates(template: string, options: PreprocessOptions): PreprocessedOutput;
export {};
