import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './lite-indexer.js';

export function createSqlite(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA_SQL);
  return wrap(db);
}

function wrap(db) {
  return {
    exec(sql) {
      db.exec(sql);
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    get(sql, params = []) {
      return db.prepare(sql).get(...params);
    },
    run(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
  };
}
