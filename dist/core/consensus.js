import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, collaborationStatus, saveConsensusEvaluation, recordEvent, addEvidence } from './db.js';
function clamp(n) { return Math.max(0, Math.min(1, n)); }
export async function evaluateConsensus(root, sessionId) {
    const db = await openDb(path.resolve(root));
    try {
        const data = collaborationStatus(db, sessionId);
        if (!data?.session)
            throw new Error(`Collaboration session not found: ${sessionId}`);
        const messages = (data.messages || []);
        const latest = (data.decisions || []).at(-1);
        if (!latest)
            throw new Error(`No collaboration decision exists for session: ${sessionId}`);
        const decision = String(latest.decision);
        const roles = new Set(messages.filter(m => m.agent_role).map(m => m.agent_role));
        const supportKinds = new Set(['PROPOSAL', 'FINDING', 'RECOMMENDATION', 'EVIDENCE']);
        const dissentKinds = new Set(['QUESTION', 'OBJECTION']);
        const supportCount = messages.filter(m => supportKinds.has(m.kind)).length;
        const dissentCount = messages.filter(m => dissentKinds.has(m.kind)).length;
        const blockerCount = messages.filter(m => m.kind === 'BLOCKER').length;
        const evidenceCount = messages.filter(m => m.kind === 'EVIDENCE').length;
        const confidenceValues = messages.map(m => Number(m.confidence)).filter(n => Number.isFinite(n));
        const confidence = confidenceValues.length ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length : 0.5;
        const quorum = roles.size >= Math.min(3, Math.max(2, data.session.max_rounds ? 3 : 2)) && messages.length >= 3;
        const balance = messages.length ? supportCount / messages.length : 0;
        const dissentPenalty = Math.min(0.35, (dissentCount / messages.length) * 0.5);
        const blockerPenalty = Math.min(0.5, (blockerCount / messages.length) * 0.8);
        const evidenceBonus = Math.min(0.15, evidenceCount * 0.03);
        const score = clamp((quorum ? 0.2 : 0) + (balance * 0.45) + (confidence * 0.25) + evidenceBonus - dissentPenalty - blockerPenalty);
        let level = score >= 0.8 ? 'STRONG' : score >= 0.6 ? 'MODERATE' : score >= 0.35 ? 'WEAK' : 'NO_CONSENSUS';
        const unresolved = [];
        if (dissentCount > 0)
            unresolved.push(`${dissentCount} dissent/question message(s) require resolution`);
        if (blockerCount > 0)
            unresolved.push(`${blockerCount} blocker message(s) remain`);
        const recommendation = blockerCount > 0 || decision === 'BLOCK' ? 'BLOCK' :
            !quorum || level === 'NO_CONSENSUS' ? 'NEED_HUMAN' :
                decision === 'REVISE' || level === 'WEAK' ? 'REVISE' :
                    decision === 'NEED_HUMAN' ? 'NEED_HUMAN' : 'ACCEPT';
        if ((data.session.task_id && /high|critical/i.test(String(data.session.risk || ''))) && recommendation === 'ACCEPT')
            unresolved.push('High/critical risk requires existing human approval gates');
        const now = new Date().toISOString();
        const evaluation = { id: `CONS-${Date.now()}-${randomUUID().slice(0, 8)}`, sessionId, decision, level, score, quorum, uniqueRoles: roles.size, messageCount: messages.length, supportCount, dissentCount, blockerCount, evidenceCount, confidence, unresolvedConflicts: unresolved, recommendation, createdAt: now };
        saveConsensusEvaluation(db, evaluation);
        addEvidence(db, { id: `CONSENSUS-EVIDENCE-${evaluation.id}`, taskId: data.session.task_id, kind: 'consensus_evaluation', status: recommendation === 'ACCEPT' ? 'pass' : recommendation === 'BLOCK' ? 'fail' : 'info', payload: evaluation });
        recordEvent(db, 'collaboration.consensus_evaluated', evaluation, data.session.task_id);
        return evaluation;
    }
    finally {
        db.close();
    }
}
export async function consensusStatusProject(root, sessionId) { const db = await openDb(path.resolve(root)); try {
    return db.prepare(sessionId ? 'SELECT * FROM consensus_evaluations WHERE session_id=? ORDER BY created_at DESC' : 'SELECT * FROM consensus_evaluations ORDER BY created_at DESC LIMIT 100').all(...(sessionId ? [sessionId] : []));
}
finally {
    db.close();
} }
