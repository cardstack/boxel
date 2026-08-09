import QUnit from 'qunit';
const { module, test } = QUnit;
import { resolveRelative, walkSourceGraph } from '../src/source-graph.ts';

function files(entries: Record<string, string>): Map<string, Buffer> {
  return new Map(
    Object.entries(entries).map(([path, content]) => [
      path,
      Buffer.from(content, 'utf8'),
    ]),
  );
}

module('the source graph', () => {
  test('resolves relative specifiers the way node would', (assert) => {
    let tree = files({
      'src/index.js': '',
      'src/math/Vector3.js': '',
      'src/util/index.js': '',
    });
    assert.strictEqual(
      resolveRelative('src/index.js', './math/Vector3.js', tree),
      'src/math/Vector3.js',
    );
    assert.strictEqual(
      resolveRelative('src/index.js', './math/Vector3', tree),
      'src/math/Vector3.js',
      'extensionless resolves',
    );
    assert.strictEqual(
      resolveRelative('src/index.js', './util', tree),
      'src/util/index.js',
      'directory resolves to its index',
    );
    assert.strictEqual(
      resolveRelative('src/index.js', './nope.js', tree),
      undefined,
    );
  });

  test('walks a module graph and reports what it could not follow', (assert) => {
    let tree = files({
      'src/index.js': `import { a } from './a.js';\nexport * from './b.js';\nimport 'node:fs';\nimport x from 'lodash';\n`,
      'src/a.js': `import './deep/c.js';\nexport const a = 1;\n`,
      'src/b.js': `export const b = 2;\n`,
      'src/deep/c.js': `export const c = 3;\n`,
      'src/orphan.js': `export const never = 0;\n`,
    });
    let graph = walkSourceGraph(tree, 'src/index.js');
    assert.deepEqual(graph.modules, [
      'src/a.js',
      'src/b.js',
      'src/deep/c.js',
      'src/index.js',
    ]);
    assert.notOk(
      graph.modules.includes('src/orphan.js'),
      'unreachable files are not part of the graph',
    );
    assert.deepEqual(graph.externals, ['lodash', 'node:fs']);
    assert.deepEqual(graph.unresolved, []);
  });

  test('multi-line and re-export forms are followed', (assert) => {
    let tree = files({
      'src/index.js': `import {\n  One,\n  Two\n} from '../lib/pair.js';\nexport { Three } from './three.js';\n`,
      'lib/pair.js': `export const One = 1, Two = 2;\n`,
      'src/three.js': `export const Three = 3;\n`,
    });
    assert.deepEqual(walkSourceGraph(tree, 'src/index.js').modules, [
      'lib/pair.js',
      'src/index.js',
      'src/three.js',
    ]);
  });

  // Both of these are real: leaflet documents inheritance in prose that
  // ended in a `from "…"`, and standardized-audio-context documents import
  // syntax inside a block comment.
  test('an import example inside a comment is not a dependency', (assert) => {
    let tree = files({
      'src/index.js': `/*\n * import defaultImport from './path';\n */\n// import { x } from 'ghost';\nimport { real } from './real.js';\n`,
      'src/real.js': 'export const real = 1;\n',
    });
    let graph = walkSourceGraph(tree, 'src/index.js');
    assert.deepEqual(graph.modules, ['src/index.js', 'src/real.js']);
    assert.deepEqual(graph.externals, [], 'the commented "ghost" is ignored');
    assert.deepEqual(graph.unresolved, [], 'the commented "./path" is ignored');
  });

  test('prose that merely contains the word from is not an import', (assert) => {
    let tree = files({
      'src/index.js':
        'export var Marker = Layer.extend({\n  // Option inherited from "Interactive layer"\n  icon: 1,\n});\n',
    });
    assert.deepEqual(walkSourceGraph(tree, 'src/index.js').externals, []);
  });
});
