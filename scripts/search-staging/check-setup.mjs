import { stagingDatabase } from './database.mjs';
const { db, categories } = await stagingDatabase();
console.log(JSON.stringify({ categories: categories.length, departments: categories.filter(c=>!c.parent_id).length, aliases: (await db.query('select count(*) from catalogue_search_aliases')).rows[0].count }));
await db.close();
