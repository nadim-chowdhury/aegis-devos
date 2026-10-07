import { loadConfig, listTasks } from './config.js';
import { openDb, syncTask } from './db.js';
import path from 'node:path';
export async function syncProject(project) { const root = path.resolve(project); const db = await openDb(root); for (const t of await listTasks(root))
    syncTask(db, { id: t.id, status: t.status, priority: t.priority || 0, title: t.title, dependsOn: t.depends_on || [] }); db.close(); await loadConfig(root); }
