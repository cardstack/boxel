/* eslint-env node */
import { readFileSync, readdirSync, writeFileSync } from 'fs-extra';
import { resolve, join } from 'path';
import {
  parse,
  type CreateTableStmt,
  type AlterTableStmt,
  type Program,
} from 'sql-parser-cst';

// Currently this script only cares about CREATE TABLE statements and ALTER
// TABLE statements that add primary key constraints. All the other schema aspects of the
// pg_dump are generally beyond the capability of SQLite. Perhaps index creation
// can be added but it will get really tricky fast since SQLite's indices are
// more more simplistic than postgres.

const args = process.argv;
const migrationsDir = resolve(join(__dirname, '..', 'migrations'));
const sqliteSchemaDir = resolve(
  join(__dirname, '..', '..', 'host', 'config', 'schema'),
);
const INDENT = '  ';

let pgDumpFile = args[2];
if (!pgDumpFile) {
  console.error(`please specify the path of the pg_dump file`);
  process.exit(-1);
}
let pgDump = readFileSync(pgDumpFile, 'utf8');

let cst = parse(prepareDump(pgDump), {
  dialect: 'postgresql',
  includeSpaces: true,
  includeNewlines: true,
  includeComments: true,
  includeRange: true,
});

let sql: string[] = [
  `
-- This is auto-generated from packages/realm-server/scripts/convert-to-sqlite.ts
-- Please don't directly modify this file

`,
];
for (let statement of cst.statements) {
  if (statement.type !== 'create_table_stmt') {
    continue;
  }
  sql.push('CREATE TABLE IF NOT EXISTS');
  if (
    statement.name.type === 'member_expr' &&
    statement.name.property.type === 'identifier'
  ) {
    let tableName = statement.name.property.name;
    sql.push(statement.name.property.name, '(\n');
    createColumns(cst, tableName, statement, sql);
  } else {
    throw new Error(`could not determine table name to be created`);
  }

  sql.push('\n);\n\n');
}

let result = sql.join(' ').trim();
let filename = getSchemaFilename();
let schemaFile = join(sqliteSchemaDir, filename);
writeFileSync(schemaFile, result);
console.log(`created SQLite schema file ${schemaFile}`);

function createColumns(
  cst: Program,
  tableName: string,
  statement: CreateTableStmt,
  sql: string[],
) {
  if (!statement.columns) {
    return;
  }
  let columns: string[] = [];
  for (let item of statement.columns.expr.items) {
    if (item.type !== 'column_definition') {
      continue;
    }
    let column: string[] = [];
    column.push(INDENT, item.name.name);
    if (item.dataType?.type === 'named_data_type') {
      let dataTypeName = Array.isArray(item.dataType.nameKw)
        ? item.dataType.nameKw[0]
        : item.dataType.nameKw;
      switch (dataTypeName.name) {
        case 'CHARACTER':
          column.push('TEXT');
          break;
        case 'JSONB':
          // TODO change this to 'BLOB' after we do the sqlite BLOB storage
          // support in CS-6668 for faster performance
          column.push('JSON');
          break;
        case 'BOOLEAN':
          column.push('BOOLEAN');
          break;
        case 'INTEGER':
          column.push('INTEGER');
          break;
      }
    }
    for (let constraint of item.constraints) {
      switch (constraint.type) {
        case 'constraint_not_null':
          column.push('NOT NULL');
          break;
        case 'constraint_primary_key':
          column.push('PRIMARY KEY');
          break;
        default:
          throw new Error(
            `Don't know how to serialize constraint ${constraint.type} for column '${item.name.name}'`,
          );
      }
    }

    columns.push(column.join(' '));
  }
  sql.push([...columns, makePrimaryKeyConstraint(cst, tableName)].join(',\n'));
}

function makePrimaryKeyConstraint(cst: Program, tableName: string): string {
  let alterTableStmts = cst.statements.filter(
    (s) =>
      s.type === 'alter_table_stmt' &&
      s.table.type === 'table_without_inheritance' &&
      s.table.table.type === 'member_expr' &&
      s.table.table.property.type === 'identifier' &&
      s.table.table.property.name === tableName,
  ) as AlterTableStmt[];
  let pkConstraint: string[] = [];
  for (let alterTableStmt of alterTableStmts) {
    for (let item of alterTableStmt.actions.items) {
      if (item.type === 'alter_action_add_constraint') {
        switch (item.constraint.type) {
          case 'constraint_primary_key': {
            if (pkConstraint.length > 0) {
              throw new Error(
                `encountered multiple primary key constraints for table ${tableName}`,
              );
            }
            if (item.constraint.columns) {
              let columns: string[] = [];
              if (item.constraint.columns.type === 'paren_expr') {
                for (let column of item.constraint.columns.expr.items) {
                  if (
                    column.type === 'index_specification' &&
                    column.expr.type === 'identifier'
                  ) {
                    columns.push(column.expr.name);
                  }
                }
              } else {
                throw new Error(
                  `Don't know how to serialize constraint ${item.constraint.type} for table '${tableName}'`,
                );
              }
              if (columns.length > 0) {
                pkConstraint.push(
                  INDENT,
                  'PRIMARY KEY (',
                  columns.join(', '),
                  ')',
                );
              }
            }
            break;
          }
          default:
            throw new Error(
              `Don't know how to serialize constraint ${item.constraint.type} for table '${tableName}'`,
            );
        }
      }
    }
  }
  return pkConstraint.join(' ');
}

// This strips out all the things that our SQL AST chokes on (it's still in an
// experimental phase for postgresql)
function prepareDump(sql: string): string {
  let result = sql
    .replace(/\s*SET\s[^;].*;/gm, '')
    .replace(/\s*CREATE\sTYPE\s[^;]*;/gm, '');
  return result;
}

function getSchemaFilename(): string {
  let files = readdirSync(migrationsDir);
  let lastFile = files
    .filter((f) => f !== '.eslintrc.js')
    .sort()
    .pop()!;
  return `${lastFile.replace(/_.*/, '')}_schema.sql`;
}
