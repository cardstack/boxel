// Validates the `credit_charge_usage` unit check the AI batch settlement
// migration added NOT VALID. VALIDATE CONSTRAINT takes a lock that lets
// charges keep writing while it scans the existing rows.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE credit_charge_usage
      VALIDATE CONSTRAINT credit_charge_usage_unit_check
  `);
};

// Validating changes nothing to undo.
exports.down = () => {};
