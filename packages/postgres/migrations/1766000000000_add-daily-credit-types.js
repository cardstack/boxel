exports.up = (pgm) => {
  pgm.addTypeValue('credit_type', 'daily_credit');
  pgm.addTypeValue('credit_type', 'daily_credit_used');
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TYPE credit_type DROP VALUE IF EXISTS 'daily_credit_used'`);
  pgm.sql(`ALTER TYPE credit_type DROP VALUE IF EXISTS 'daily_credit'`);
};
