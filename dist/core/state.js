import path from 'node:path';
import { readText, writeText, ensureDir } from './fs.js';
import { saveTask } from './config.js';
export async function writeState(root, data) {
    await ensureDir(path.join(root, '.ai'));
    const lines = ['# Aegis State', '', ...Object.entries(data).map(([k, v]) => `- **${k}**: ${typeof v === 'string' ? v : JSON.stringify(v)}`), ''];
    await writeText(path.join(root, '.ai/STATE.md'), lines.join('\n'));
}
export async function transition(root, task, status, extra = {}) {
    task.status = status;
    await saveTask(root, task);
    await writeState(root, { task: task.id, status, updatedAt: new Date().toISOString(), ...extra });
}
export async function readState(root) { try {
    return await readText(path.join(root, '.ai/STATE.md'));
}
catch {
    return '';
} }
