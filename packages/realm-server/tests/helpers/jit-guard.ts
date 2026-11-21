import pg from 'pg';

// Which search statements would JIT-compile on a server that compiles
// everything. While `fn` runs, each connection is switched to JIT on with its
// cost thresholds at 0 (as a session setting, the first time the connection
// is seen outside a transaction, so a transaction's own SET LOCAL still
// decides), and every SELECT (or WITH) that reads a search table is first
// explained on its own connection, in its own transaction: a plan with a JIT
// section is one that would compile. The search settings turn JIT off for
// every search statement (search-session.ts); a statement that reaches the
// database without them shows up here. Explaining reads nothing and changes
// no data, so the statement then runs as it would have.
// a statement that reads one of the search tables (named after FROM or
// JOIN, so a statement that only computes a partition's name is not one)
const SEARCH_TABLES =
  /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:boxel_index|boxel_index_values|boxel_index_value_paths|boxel_index_words|boxel_index_vectors\w*|boxel_vector_spaces|boxel_log_lines\w*|boxel_log_files|boxel_log_realms|prerendered_html)\b/i;
const READ = /^\s*(SELECT|WITH)\b/i;
const BEGIN = /^\s*BEGIN\b/i;
const END = /^\s*(COMMIT|ROLLBACK|END)\s*;?\s*$/i;

export interface JitReport {
  // statements explained
  checked: number;
  // the start of each one whose plan would compile
  compiled: string[];
}

export async function searchStatementsJit<T>(
  fn: () => Promise<T>,
  // statements that are not searches, left unchecked (a card read by URL)
  opts: { ignore?: RegExp[] } = {},
): Promise<{ value: T } & JitReport> {
  let proto = pg.Client.prototype as any;
  let original = proto.query;
  let report: JitReport = { checked: 0, compiled: [] };
  let pending: Promise<unknown>[] = [];
  let state = new WeakMap<object, { inTx: boolean; forced: boolean }>();
  let forced = new Set<pg.Client>();
  proto.query = function (this: pg.Client, config: any, values?: any, cb?: any) {
    let text: unknown = typeof config === 'string' ? config : config?.text;
    if (typeof text !== 'string') {
      return original.call(this, config, values, cb);
    }
    let s = state.get(this) ?? { inTx: false, forced: false };
    state.set(this, s);
    // queued ahead of the statement on the same connection
    if (!s.inTx && !s.forced) {
      original
        .call(this, 'SET jit = on; SET jit_above_cost = 0')
        .catch(() => {});
      s.forced = true;
      forced.add(this);
    }
    if (BEGIN.test(text)) {
      s.inTx = true;
    }
    if (
      READ.test(text) &&
      SEARCH_TABLES.test(text) &&
      !text.includes(';') &&
      !(opts.ignore ?? []).some((re) =>
        re.test((text as string).replace(/\s+/g, ' ').trim()),
      )
    ) {
      let bound = Array.isArray(values) ? values : config?.values;
      pending.push(
        original
          .call(this, { text: `EXPLAIN (FORMAT JSON) ${text}`, values: bound })
          .then((result: any) => {
            report.checked++;
            let plan = result.rows?.[0]?.['QUERY PLAN']?.[0];
            if (plan?.JIT) {
              report.compiled.push(text.replace(/\s+/g, ' ').slice(0, 160));
            }
          })
          .catch(() => {}),
      );
    }
    if (END.test(text)) {
      s.inTx = false;
    }
    return original.call(this, config, values, cb);
  };
  try {
    let value = await fn();
    await Promise.all(pending);
    return { value, ...report };
  } finally {
    proto.query = original;
    // the connections go back to the server's own settings
    await Promise.all(
      [...forced].map((client) =>
        original.call(client, 'RESET jit; RESET jit_above_cost').catch(() => {}),
      ),
    );
  }
}
