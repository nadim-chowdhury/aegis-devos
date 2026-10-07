import { spawn } from 'node:child_process';
import { sanitizedWorkerEnv } from '../core/security.js';
function classify(s) {
    const x = s.toLowerCase();
    if (/quota|rate.?limit|limit exceeded|resource exhausted|too many requests|\b429\b/.test(x))
        return 'quota';
    if (/timeout|timed out|deadline exceeded|abort/.test(x))
        return 'timeout';
    if (/unauthori[sz]ed|authentication required|authentication|invalid api key|credential|forbidden/.test(x))
        return 'auth';
    if (/unavailable|temporarily|service error|\b503\b/.test(x))
        return 'unavailable';
    return 'execution';
}
function result(started, success, output, exitCode, error, extra = {}) {
    return { success, output, exitCode, durationMs: Date.now() - started, errorType: success ? undefined : classify(error || output), ...extra };
}
function resolveKey(defaultEnv, overrideEnv) { const target = overrideEnv || defaultEnv; const value = process.env[target]; if (!value)
    throw new Error(`Missing required environment variable: ${target}`); return value; }
function env(name) { return resolveKey(name); }
async function fetchJson(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
        const text = await r.text();
        let body;
        try {
            body = JSON.parse(text);
        }
        catch {
            body = { text };
        }
        ;
        if (!r.ok)
            throw new Error(`HTTP ${r.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
        return body;
    }
    finally {
        clearTimeout(timer);
    }
}
function extractOpenAI(body) { return body?.choices?.[0]?.message?.content || body?.output?.[0]?.content?.map((x) => x.text || '').join('') || ''; }
async function openai(r, w) { const started = Date.now(); try {
    const key = resolveKey('OPENAI_API_KEY', r.credentialEnvVar || w.credentialEnvVar);
    const body = await fetchJson(process.env.AEGIS_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ model: w.model, messages: [{ role: 'user', content: r.prompt }] }) }, r.timeoutMs);
    return result(started, true, extractOpenAI(body), 0, undefined, { usage: body?.usage });
}
catch (e) {
    return result(started, false, String(e), null, String(e));
} }
async function anthropic(r, w) { const started = Date.now(); try {
    const key = resolveKey('ANTHROPIC_API_KEY', r.credentialEnvVar || w.credentialEnvVar);
    const body = await fetchJson(process.env.AEGIS_ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01' }, body: JSON.stringify({ model: w.model, max_tokens: Number(process.env.AEGIS_ANTHROPIC_MAX_TOKENS || 8192), messages: [{ role: 'user', content: r.prompt }] }) }, r.timeoutMs);
    const output = body?.content?.filter((x) => x.type === 'text').map((x) => x.text).join('') || '';
    return result(started, true, output, 0, undefined, { usage: body?.usage });
}
catch (e) {
    return result(started, false, String(e), null, String(e));
} }
async function gemini(r, w) { const started = Date.now(); try {
    const base = process.env.AEGIS_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const key = resolveKey('GEMINI_API_KEY', r.credentialEnvVar || w.credentialEnvVar);
    const body = await fetchJson(`${base}/models/${encodeURIComponent(w.model)}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: r.prompt }] }] }) }, r.timeoutMs);
    const output = body?.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || '';
    return result(started, true, output, 0, undefined, { usage: body?.usageMetadata });
}
catch (e) {
    return result(started, false, String(e), null, String(e));
} }
function command(r, w) { return new Promise(resolve => { const started = Date.now(); const cmd = w.command; if (!cmd)
    return resolve(result(started, false, 'Worker command is not configured', null, 'Worker command is not configured')); const args = w.argsTemplate; const actual = args?.map(x => x.replaceAll('{prompt}', r.prompt).replaceAll('{model}', r.model).replaceAll('{project}', r.projectPath)) || [r.prompt]; const child = spawn(cmd, actual, { cwd: r.projectPath, shell: false, env: sanitizedWorkerEnv(process.env) }); let out = '', err = ''; let settled = false; const finish = (x) => { if (settled)
    return; settled = true; clearTimeout(timer); resolve(x); }; const timer = setTimeout(() => { child.kill('SIGTERM'); finish(result(started, false, 'Worker timeout', null, 'timeout')); }, r.timeoutMs); child.stdout.on('data', d => { out += String(d); r.onEvent?.({ type: 'stdout', raw: String(d) }); }); child.stderr.on('data', d => { err += String(d); r.onEvent?.({ type: 'stderr', raw: String(d) }); }); child.on('error', e => finish(result(started, false, String(e), null, String(e)))); child.on('close', code => { const output = out.trim() || err.trim(); finish(result(started, code === 0, output, code, code === 0 ? undefined : output)); }); }); }
export async function runWorker(r, w) {
    switch ((w.provider || 'antigravity').toLowerCase()) {
        case 'antigravity': return import('./antigravity.js').then(m => m.runAntigravity(r));
        case 'openai': return openai(r, w);
        case 'anthropic': return anthropic(r, w);
        case 'gemini': return gemini(r, w);
        case 'command':
        case 'cli': return command(r, w);
        default: return result(Date.now(), false, `Unsupported worker provider: ${w.provider}`, null, `Unsupported worker provider: ${w.provider}`);
    }
}
export async function checkWorker(w, projectPath, timeoutMs) {
    const r = { projectPath, model: w.model, prompt: 'Respond with exactly: AEGIS_WORKER_OK', timeoutMs };
    const started = Date.now();
    const result = await runWorker(r, w);
    return { workerId: w.id, provider: w.provider, model: w.model, success: result.success, latencyMs: Date.now() - started, errorType: result.errorType, error: result.success ? undefined : result.output };
}
