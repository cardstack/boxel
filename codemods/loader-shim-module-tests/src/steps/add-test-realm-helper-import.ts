import type { Options } from '../types/index.js';
import { findFiles } from '@codemod-utils/files';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AST } from '@codemod-utils/ast-javascript';

export function addTestRealmHelperImport(options: Options): void {
  const { projectRoot } = options;

  let filePaths = findFiles(
    'tests/{acceptance,integration,unit}/**/*-test.{js,ts,gts,gjs}',
    {
      projectRoot,
    },
  );
  filePaths = filePaths.filter((filePath) => {
    return readFileSync(join(projectRoot, filePath), 'utf8').includes(
      'loader.shimModule',
    );
  });

  const traverse = AST.traverse(true);
  filePaths.forEach((filePath) => {
    const ast = traverse(join(projectRoot, filePath), {
      /* Use AST.builders to transform the tree */
    });

    const result = AST.print(ast);
    writeFileSync(join(projectRoot, filePath), result, 'utf8');
  });
}
