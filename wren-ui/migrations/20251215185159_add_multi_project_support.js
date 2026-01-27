/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .table('project', (table) => {
      // Add name field for project identification
      table
        .string('name')
        .nullable()
        .comment('Project name for identification');

      // Add is_active field to track current active project
      table
        .boolean('is_active')
        .defaultTo(false)
        .comment('Is this the active project');

      // Add last_accessed_at field to track usage
      table
        .timestamp('last_accessed_at')
        .nullable()
        .comment('Last time this project was accessed');

      // Add index for faster queries
      table.index(['is_active']);
    })
    .then(() => {
      // Set the first project as active if exists
      return knex('project')
        .select('id')
        .orderBy('id', 'asc')
        .limit(1)
        .then((projects) => {
          if (projects.length > 0) {
            return knex('project').where('id', projects[0].id).update({
              is_active: true,
              name: 'Default Project',
              last_accessed_at: knex.fn.now(),
            });
          }
        });
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('project', (table) => {
    table.dropIndex(['is_active']);
    table.dropColumn('name');
    table.dropColumn('is_active');
    table.dropColumn('last_accessed_at');
  });
};
