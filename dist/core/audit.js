import path from 'node:path';
import { git } from './git.js';
import { loadTask } from './config.js';
import { enforcePolicy } from './policy.js';
export async function auditRun(root, taskId, config) {
    const task = await loadTask(root, taskId);
    const status = await git(root, ['status', '--short']);
    await enforcePolicy(root, task, config);
    const diff = await git(root, ['diff', '--stat', 'HEAD']);
    return { taskId, cleanViolations: status ? status.split('\n').length : 0, diff, checkedAt: new Date().toISOString(), policy: 'passed', cwd: path.resolve(root) };
}
