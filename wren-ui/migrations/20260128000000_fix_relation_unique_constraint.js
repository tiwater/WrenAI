/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // SQLite doesn't support DROP CONSTRAINT directly, so we need to recreate the table
  // First, check if we're using SQLite
  const isSQLite = knex.client.config.client === 'better-sqlite3';

  if (isSQLite) {
    // For SQLite: recreate table with new constraint
    await knex.schema.renameTable('relation', 'relation_old');

    await knex.schema.createTable('relation', (table) => {
      table.increments('id').comment('ID');
      table.integer('project_id').comment('Reference to project.id');
      table.string('name').comment('relation name');
      table
        .string('join_type')
        .comment('join type, eg:"ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE"');
      table
        .integer('from_column_id')
        .comment('from column id, "{fromColumn} {joinType} {toSideColumn}"');
      table
        .integer('to_column_id')
        .comment('to column id, "{fromColumn} {joinType} {toSideColumn}"');
      table.string('properties').comment('Model properties, a json string');
      table.timestamps(true, true);

      // Add composite unique constraint on project_id and name
      table.unique(['project_id', 'name']);
    });

    // Copy data from old table
    await knex.raw(`
      INSERT INTO relation (id, project_id, name, join_type, from_column_id, to_column_id, properties, created_at, updated_at)
      SELECT id, project_id, name, join_type, from_column_id, to_column_id, properties, created_at, updated_at
      FROM relation_old
    `);

    // Drop old table
    await knex.schema.dropTable('relation_old');
  } else {
    // For PostgreSQL: use ALTER TABLE
    await knex.schema.alterTable('relation', (table) => {
      table.dropUnique(['name']);
      table.unique(['project_id', 'name']);
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const isSQLite = knex.client.config.client === 'better-sqlite3';

  if (isSQLite) {
    await knex.schema.renameTable('relation', 'relation_old');

    await knex.schema.createTable('relation', (table) => {
      table.increments('id').comment('ID');
      table.integer('project_id').comment('Reference to project.id');
      table.string('name').comment('relation name').unique();
      table
        .string('join_type')
        .comment('join type, eg:"ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE"');
      table
        .integer('from_column_id')
        .comment('from column id, "{fromColumn} {joinType} {toSideColumn}"');
      table
        .integer('to_column_id')
        .comment('to column id, "{fromColumn} {joinType} {toSideColumn}"');
      table.string('properties').comment('Model properties, a json string');
      table.timestamps(true, true);
    });

    await knex.raw(`
      INSERT INTO relation (id, project_id, name, join_type, from_column_id, to_column_id, properties, created_at, updated_at)
      SELECT id, project_id, name, join_type, from_column_id, to_column_id, properties, created_at, updated_at
      FROM relation_old
    `);

    await knex.schema.dropTable('relation_old');
  } else {
    await knex.schema.alterTable('relation', (table) => {
      table.dropUnique(['project_id', 'name']);
      table.unique(['name']);
    });
  }
};
