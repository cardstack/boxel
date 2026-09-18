// Additive phase: preserve the old revision's isNewIndex decision. Recovery
// floors and summary reset run only after old workers drain (removal phase).
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql("SET lock_timeout = '2s'");
  pgm.sql("SET statement_timeout = '30s'");
  pgm.sql('ALTER TABLE realm_generations SET LOGGED');
  pgm.sql('RESET lock_timeout');
  pgm.sql('RESET statement_timeout');
};
exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql("SET lock_timeout = '2s'");
  pgm.sql('ALTER TABLE realm_generations SET UNLOGGED');
  pgm.sql('RESET lock_timeout');
};
