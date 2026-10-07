import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
export async function quality(project, config, names) {
    const results = [];
    for (const name of names) {
        const g = config.quality?.gates?.[name];
        if (!g)
            continue;
        const required = g.required !== false;
        const started = Date.now();
        try {
            const r = await run(g.command, { cwd: project, maxBuffer: 5_000_000 });
            results.push({ name, required, ok: true, durationMs: Date.now() - started, output: r.stdout + r.stderr });
        }
        catch (e) {
            results.push({ name, required, ok: false, durationMs: Date.now() - started, output: String(e.stdout || '') + String(e.stderr || e.message) });
            if (required)
                break;
        }
    }
    return { ok: results.filter(x => x.required).every(x => x.ok), results };
}
