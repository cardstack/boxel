/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// vendored from https://github.com/luvies/format-tree/ because I can't get install to work... Deno??
function stringLength(str: string) {
  return str.length;
}

export interface Options {
  /**
   * The split string to use to separate the tree and the extra string.
   * @default ' | '
   */
  extraSplit?: string;
  /**
   * The function used to format the guides. Mainly used for adding
   * colours to the guides (e.g. using chalk).
   */
  guideFormat?: (guide: string) => string;
  /**
   * Whether the text should be displayed inset into the guides or not.
   *
   * 0:
   * ```
   * first           | extra
   * ├── second      | another
   * ├─┬ third
   * │ ├── fourth    | yet
   * │ ├── fifth
   * │ └─┬ sixth     | another
   * │   ├── seventh | one
   * │   └─┬ eighth  | look
   * │     ├── ninth | another
   * │     └── tenth | one
   * └── eleventh    | yay
   * ```
   * 1:
   * ```
   * first             | extra
   * ├─ second         | another
   * ├─ third
   * │  ├─ fourth      | yet
   * │  ├─ fifth
   * │  └─ sixth       | another
   * │     ├─ seventh  | one
   * │     └─ eighth   | look
   * │        ├─ ninth | another
   * │        └─ tenth | one
   * └─ eleventh       | yay
   * ```
   * 2:
   * ```
   * first         | extra
   * ├ second      | another
   * ├ third
   * │ ├ fourth    | yet
   * │ ├ fifth
   * │ └ sixth     | another
   * │   ├ seventh | one
   * │   └ eighth  | look
   * │     ├ ninth | another
   * │     └ tenth | one
   * └ eleventh    | yay
   * ```
   */
  inset?: number;
}

export interface TreeNode {
  /**
   * The children nodes to add under this one.
   */
  children?: TreeNode[];
  /**
   * The extra text to align to the right of the tree.
   */
  extra?: string;
  /**
   * The text for this node.
   */
  text: string;
}

/**
 * Formats the tree into a single string, each line split by \n.
 *
 * @param tree The tree to format into a string.
 * @param options The options to pass to the formatter.
 * @returns The formatted string.
 */
export function formatTreeString(
  tree: TreeNode | TreeNode[],
  options?: Options,
): string {
  return formatTree(tree, options).join('\n');
}

/**
 * Formats the tree into a list of string, each item in the list a single line.
 *
 * @param tree The tree to format into a string.
 * @param options The options to pass to the formatter.
 * @returns The formatted lines.
 */
export function formatTree(
  tree: TreeNode | TreeNode[],
  options: Options = {},
): string[] {
  let toBuild: Array<{ extra?: string; line: string }> = [];
  let shouldFirstCap = true;
  let inset = options.inset || 0;

  // process nodes function
  let processNodes = (nodes: TreeNode[], prefix: string) => {
    for (let i = 0; i < nodes.length; i++) {
      // shorthands
      let node = nodes[i];

      // set up guide for current node
      let guide: string;
      let last = i === nodes.length - 1;
      let hasChildren = node.children && node.children.length;
      if (shouldFirstCap) {
        if (last) {
          guide = '─';
        } else {
          guide = '┌';
        }
        shouldFirstCap = false;
      } else {
        if (last) {
          guide = '└';
        } else {
          guide = '├';
        }
      }
      if (inset !== 2) {
        guide += '─';
        if (inset !== 1) {
          if (hasChildren) {
            guide += '┬';
          } else {
            guide += '─';
          }
        }
      }
      guide += ' ';

      // apply format function
      if (options.guideFormat) {
        guide = options.guideFormat(guide);
      }

      // build current line
      toBuild.push({
        line: prefix + guide + node.text,
        extra: node.extra,
      });

      // build children
      if (hasChildren) {
        let nprefix =
          prefix + (last ? ' ' : '│') + ' ' + (inset === 1 ? ' ' : '');
        if (options.guideFormat) {
          nprefix = options.guideFormat(nprefix);
        }
        processNodes(node.children!, nprefix);
      }
    }
  };

  // start tree formatting
  let tr: TreeNode[] | undefined;
  if (Array.isArray(tree)) {
    tr = tree;
  } else {
    toBuild.push({
      line: tree.text,
      extra: tree.extra,
    });
    tr = tree.children;
    shouldFirstCap = false;
  }
  if (tr) {
    processNodes(tr, '');
  }

  // get the longest name so we can format the extra text occordingly
  let maxLen = 0;
  for (let item of toBuild) {
    maxLen = Math.max(maxLen, stringLength(item.line));
  }

  // add extra text and build full output
  let output: string[] = [];
  let extraSplit =
    typeof options.extraSplit === 'undefined' ? ' | ' : options.extraSplit;
  for (let item of toBuild) {
    let line = item.line;
    if (item.extra) {
      line +=
        ' '.repeat(maxLen - stringLength(item.line)) +
        `${extraSplit}${item.extra}`;
    }
    output.push(line);
  }

  return output;
}
