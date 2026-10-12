import type { Schema } from '../frontend/src/contract';

export default {
  tables: [
    {
      name: "users",
      note: "People who create todo lists.",
      columns: [
        {"name": "id", "type": "int", "pk": true, "notNull": true, "unique": false, "note": null, "isFk": false},
        {"name": "name", "type": "varchar(100)", "pk": false, "notNull": true, "unique": false, "note": null, "isFk": false},
        {"name": "email", "type": "varchar(255)", "pk": false, "notNull": true, "unique": true, "note": null, "isFk": false},
      ],
    },
    {
      name: "todo_lists",
      note: "Lists for organizing tasks.",
      columns: [
        {"name": "id", "type": "int", "pk": true, "notNull": true, "unique": false, "note": null, "isFk": false},
        {"name": "user_id", "type": "int", "pk": false, "notNull": true, "unique": false, "note": null, "isFk": true},
        {"name": "title", "type": "varchar(200)", "pk": false, "notNull": true, "unique": false, "note": null, "isFk": false},
      ],
    },
    {
      name: "todos",
      note: "Tasks belonging to a todo list.",
      columns: [
        {"name": "id", "type": "int", "pk": true, "notNull": true, "unique": false, "note": null, "isFk": false},
        {"name": "list_id", "type": "int", "pk": false, "notNull": true, "unique": false, "note": null, "isFk": true},
        {"name": "title", "type": "varchar(200)", "pk": false, "notNull": true, "unique": false, "note": null, "isFk": false},
        {"name": "completed", "type": "boolean", "pk": false, "notNull": true, "unique": false, "note": "True when the task is done.", "isFk": false},
        {"name": "due_at", "type": "timestamp", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false},
      ],
    },
  ],
  refs: [
    {"fromTable": "todo_lists", "fromColumn": "user_id", "toTable": "users", "toColumn": "id", "relation": ">", "note": null, "source": "inline"},
    {"fromTable": "todos", "fromColumn": "list_id", "toTable": "todo_lists", "toColumn": "id", "relation": ">", "note": null, "source": "inline"},
  ],
  groups: [],
} satisfies Schema;
