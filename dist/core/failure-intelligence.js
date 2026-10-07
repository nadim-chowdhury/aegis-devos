import { createHash, randomUUID } from 'node:crypto';
function normalize(value) {
    return value.toLowerCase()
        .replace(/run-[a-z0-9_-]+/g, 'run')
        .replace(/task-[a-z0-9_-]+/g, 'task')
        .replace(/[0-9a-f]{8,}/g, 'id')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}
function classify(reason, errorType) {
    const s = `${errorType || ''} ${reason}`.toLowerCase();
    if (/quota|rate limit|429|resource exhausted/.test(s))
        return ['quota', 'wait-and-reroute'];
    if (/auth|unauthori[sz]ed|forbidden|credential|token expired/.test(s))
        return ['auth', 'human-credential-review'];
    if (/timeout|timed out|deadline/.test(s))
        return ['timeout', 'retry-with-timeout-adjustment'];
    if (/typecheck|typescript|tsc|type error/.test(s))
        return ['typecheck', 'targeted-type-fix'];
    if (/lint|eslint|format/.test(s))
        return ['lint', 'targeted-lint-fix'];
    if (/test|assert|spec|vitest|jest|playwright|cypress/.test(s))
        return ['test', 'targeted-test-fix'];
    if (/build|compile|bundl|webpack|vite|next build/.test(s))
        return ['build', 'targeted-build-fix'];
    if (/dependency|module not found|package|npm|pnpm|yarn/.test(s))
        return ['dependency', 'dependency-investigation'];
    if (/security|vulnerab|injection|xss|csrf|ssrf|secret/.test(s))
        return ['security', 'security-review'];
    if (/conflict|merge|rebase/.test(s))
        return ['integration', 'isolated-conflict-resolution'];
    if (/policy|protected path|forbidden command/.test(s))
        return ['policy', 'human-policy-review'];
    return ['execution', 'targeted-debugging'];
}
export function analyzeFailure(db, input) {
    const reason = normalize(input.reason || 'unknown failure');
    const [category, strategy] = classify(reason, input.errorType);
    const fingerprint = createHash('sha256').update(JSON.stringify({ category, reason, taskType: input.taskType || '', domain: input.domain || '' })).digest('hex').slice(0, 24);
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT sample_count,success_count FROM failure_fingerprints WHERE fingerprint=?').get(fingerprint);
    const matches = existing?.sample_count ?? 0;
    const successes = existing?.success_count ?? 0;
    db.prepare(`INSERT INTO failure_fingerprints(fingerprint,category,task_type,domain,risk,sample_count,success_count,last_reason,last_strategy,last_run_id,created_at,updated_at)
    VALUES(?,?,?,?,?,1,0,?,?,?,?,?)
    ON CONFLICT(fingerprint) DO UPDATE SET sample_count=failure_fingerprints.sample_count+1,last_reason=excluded.last_reason,last_strategy=excluded.last_strategy,last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`)
        .run(fingerprint, category, input.taskType ?? null, input.domain ?? null, input.risk ?? null, reason, strategy, input.runId ?? null, now, now);
    db.prepare(`INSERT INTO failure_occurrences(id,fingerprint,task_id,run_id,category,reason,strategy,matched_samples,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), fingerprint, input.taskId ?? null, input.runId ?? null, category, reason, strategy, matches, now);
    return { fingerprint, category, strategy, historicalMatches: matches, historicalSuccesses: successes };
}
export function failureHistory(db, taskId, limit = 50) {
    const n = Math.max(1, Math.min(limit, 200));
    return taskId
        ? db.prepare('SELECT * FROM failure_occurrences WHERE task_id=? ORDER BY created_at DESC LIMIT ?').all(taskId, n)
        : db.prepare('SELECT * FROM failure_occurrences ORDER BY created_at DESC LIMIT ?').all(n);
}
