/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Check if the table exists first
  const hasTable = await knex.schema.hasTable('project');
  if (!hasTable) {
    // Table doesn't exist, nothing to do
    return;
  }

  // Check if the column exists before trying to drop it
  const hasColumn = await knex.schema.hasColumn('project', 'is_active');
  
  if (hasColumn) {
    // For SQLite, we need to handle index dropping differently
    const client = knex.client.config.client;
    
    if (client === 'sqlite3' || client === 'better-sqlite3') {
      // SQLite doesn't have a standard way to check if index exists
      // So we'll try to drop it and ignore errors
      try {
        await knex.raw('DROP INDEX IF EXISTS project_is_active_index');
      } catch (e) {
        // Ignore error if index doesn't exist
        console.log('Index project_is_active_index does not exist, skipping');
      }
    } else {
      // For PostgreSQL and other databases
      try {
        await knex.raw('DROP INDEX IF EXISTS project_is_active_index');
      } catch (e) {
        console.log('Index project_is_active_index does not exist, skipping');
      }
    }
    
    // Now drop the column
    return knex.schema.table('project', (table) => {
      table.dropColumn('is_active');
    });
  }
  
  // If column doesn't exist, nothing to do
  return Promise.resolve();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('project', (table) => {
    // Re-add is_active field if rolling back
    table.boolean('is_active').defaultTo(false).comment('Is this the active project');
    table.index(['is_active']);
  });
};