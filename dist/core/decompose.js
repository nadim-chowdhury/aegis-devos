import path from 'node:path';
import { writeText, ensureDir } from './fs.js';
import { loadConfig, loadTask } from './config.js';
import { buildContext } from './context.js';
import { route } from './router.js';
import { runWorker } from '../workers/adapters.js';
import { buildAgentPrompt } from '../agents/prompts.js';
import YAML from 'yaml';
export async function decompose(root, parentId) {
    const config = await loadConfig(root), task = await loadTask(root, parentId), context = await buildContext(root, task, config.defaults.max_context_chars);
    const workers = await route(root, task, config, 'architect');
    if (!workers.length)
        throw new Error('No architect worker available.');
    const prompt = buildAgentPrompt('architect', task, context) + `\n\nDECOMPOSITION MODE:\nReturn ONLY a YAML list of atomic child tasks. Each task must contain id,title,type,priority,status,objective,acceptance_criteria,depends_on,risk,assigned_role. Do not modify source files.`;
    const result = await runWorker({ projectPath: root, model: workers[0].model, prompt, timeoutMs: config.defaults.run_timeout_ms, command: workers[0].command }, workers[0]);
    if (!result.success)
        throw new Error(`Decomposition failed: ${result.output.slice(-2000)}`);
    const match = result.output.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i);
    const body = (match ? match[1] : result.output).trim();
    let tasks;
    try {
        tasks = YAML.parse(body);
    }
    catch {
        throw new Error('Architect did not return valid YAML task decomposition.');
    }
    if (!Array.isArray(tasks))
        throw new Error('Task decomposition must be a YAML array.');
    await ensureDir(path.join(root, '.ai/tasks'));
    for (const t of tasks) {
        t.version = 1;
        t.parent_task = parentId;
        t.status = t.status || 'ready';
        t.generated_by = 'architect';
        await writeText(path.join(root, '.ai/tasks', `${t.id}.yaml`), YAML.stringify(t));
    }
    return tasks;
}
