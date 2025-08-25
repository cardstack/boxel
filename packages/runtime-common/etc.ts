//@ts-ignore no types are available
import * as etc from 'ember-source/dist/ember-template-compiler';

//@ts-ignore breaks esbuild for VS Code extension
import type { EmberTemplateCompiler } from 'babel-plugin-ember-template-compilation/src/ember-template-compiler';

export const compiler = etc as unknown as EmberTemplateCompiler;
