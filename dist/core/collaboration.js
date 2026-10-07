import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, listTasks } from './config.js';
import { openDb, recordEvent, addEvidence, createCollaborationSession, addCollaborationMessage, saveCollaborationDecision, collaborationStatus, collaborationHistory } from './db.js';
import { route } from './router.js';
import { runWorker } from '../workers/adapters.js';
import { evaluateConsensus } from './consensus.js';
export const COLLABORATION_KINDS = ['PROPOSAL', 'FINDING', 'QUESTION', 'OBJECTION', 'RECOMMENDATION', 'DECISION', 'EVIDENCE', 'BLOCKER'];
function extractJson(text) { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i); const body = (fenced ? fenced[1] : text).trim(); try {
    return JSON.parse(body);
}
catch {
    const a = body.indexOf('{'), b = body.lastIndexOf('}');
    if (a >= 0 && b > a)
        return JSON.parse(body.slice(a, b + 1));
    throw new Error('Agent returned invalid collaboration JSON.');
} }
function clamp(n, min, max) { return Math.max(min, Math.min(max, Math.floor(n))); }
function roleFor(task) { const base = ['architect', 'developer', 'reviewer', 'security', 'tester']; if (task.risk === 'high' || task.risk === 'critical')
    return base.filter(x => ['architect', 'security', 'reviewer'].includes(x)); return base.slice(0, 4); }
export async function collaborateProject(root, taskId, options = {}) {
    const tasks = await listTasks(root);
    const task = tasks.find(t => t.id === taskId);
    if (!task)
        throw new Error(`Task not found: ${taskId}`);
    const config = await loadConfig(root);
    const maxRounds = clamp(options.maxRounds ?? 3, 1, 8);
    const maxMessages = clamp(options.maxMessages ?? 12, 2, 40);
    const roles = (options.roles?.length ? options.roles : roleFor(task)).slice(0, maxMessages);
    const leadRole = options.leadRole ?? 'architect';
    if (!roles.includes(leadRole))
        roles.unshift(leadRole);
    if ((task.risk === 'high' || task.risk === 'critical') && !options.roles?.length) { /* security/reviewer are intentionally included */ }
    const db = await openDb(root);
    const sessionId = `COLLAB-${Date.now()}-${randomUUID().slice(0, 8)}`;
    createCollaborationSession(db, { id: sessionId, taskId, objective: task.objective, maxRounds, maxMessages, leadRole });
    recordEvent(db, 'collaboration.started', { sessionId, taskId, maxRounds, maxMessages, roles, leadRole }, taskId);
    db.close();
    let sequence = 0;
    let transcript = [];
    let sent = 0;
    try {
        for (let round = 1; round <= maxRounds && sent < maxMessages; round++) {
            for (const role of roles) {
                if (sent >= maxMessages)
                    break;
                const pseudo = { ...task, assigned_role: role };
                const workers = await route(root, pseudo, config, role);
                if (!workers.length)
                    continue;
                const worker = workers[0];
                const prompt = `You are the ${role} specialist in a bounded Aegis collaboration.\nTASK: ${task.id} | ${task.title}\nOBJECTIVE: ${task.objective}\nACCEPTANCE: ${task.acceptance_criteria.join('; ')}\nRISK: ${task.risk || 'medium'}\nROUND: ${round}/${maxRounds}\nPRIOR MESSAGES:\n${transcript.slice(-8).join('\n---\n') || 'none'}\n\nReturn ONLY JSON: {"kind":"PROPOSAL|FINDING|QUESTION|OBJECTION|RECOMMENDATION|EVIDENCE|BLOCKER","content":"concise evidence-based message","confidence":0.0}`;
                const result = await runWorker({ projectPath: root, model: worker.model, prompt, timeoutMs: options.timeoutMs ?? config.defaults.run_timeout_ms, command: worker.command, provider: worker.provider }, worker);
                if (!result.success)
                    continue;
                let parsed;
                try {
                    parsed = extractJson(result.output);
                }
                catch {
                    parsed = { kind: 'FINDING', content: result.output.slice(-2000), confidence: 0.2 };
                }
                const kind = COLLABORATION_KINDS.includes(parsed.kind) ? parsed.kind : 'FINDING';
                const content = String(parsed.content || '').slice(0, 6000);
                if (!content)
                    continue;
                const msg = { id: randomUUID(), sessionId, round, sequence: ++sequence, agentRole: role, workerId: worker.id, model: worker.model, kind, content, confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : undefined };
                const d = await openDb(root);
                addCollaborationMessage(d, msg);
                addEvidence(d, { id: `COLLAB-EVIDENCE-${msg.id}`, taskId, kind: 'collaboration_message', status: 'info', payload: msg });
                recordEvent(d, 'collaboration.message', msg, taskId);
                d.close();
                transcript.push(`${role} ${kind}: ${content}`);
                sent++;
            }
            if (sent >= maxMessages)
                break;
            // One bounded lead synthesis per round; the final decision is synthesized after the message budget or final round.
        }
        const d = await openDb(root);
        const cstat = collaborationStatus(d, sessionId);
        const messages = cstat?.messages || [];
        d.close();
        const leadWorkers = await route(root, { ...task, assigned_role: leadRole }, config, leadRole);
        if (!leadWorkers.length)
            throw new Error('No lead worker available for collaboration synthesis.');
        const lead = leadWorkers[0];
        const synthesisPrompt = `You are the lead ${leadRole} for Aegis. Synthesize this bounded collaboration into a safe decision.\nTASK: ${task.id} | ${task.title}\nRISK: ${task.risk || 'medium'}\nMESSAGES:\n${messages.map((m) => `[${m.agent_role}/${m.kind}] ${m.content}`).join('\n')}\n\nReturn ONLY JSON: {"decision":"PROCEED|REVISE|BLOCK|NEED_HUMAN","rationale":"...","conflicts":["..."],"evidence":["message ids or concrete evidence"],"confidence":0.0}`;
        const result = await runWorker({ projectPath: root, model: lead.model, prompt: synthesisPrompt, timeoutMs: options.timeoutMs ?? config.defaults.run_timeout_ms, command: lead.command, provider: lead.provider }, lead);
        let parsed;
        try {
            parsed = extractJson(result.output);
        }
        catch {
            parsed = { decision: 'NEED_HUMAN', rationale: 'Lead synthesis failed or was not machine-readable.', conflicts: ['Invalid synthesis output'], evidence: [], confidence: 0 };
        }
        const decision = ['PROCEED', 'REVISE', 'BLOCK', 'NEED_HUMAN'].includes(parsed.decision) ? parsed.decision : 'NEED_HUMAN';
        const consequential = (task.risk === 'high' || task.risk === 'critical');
        const status = consequential && decision === 'PROCEED' ? 'NEED_HUMAN' : decision === 'BLOCK' ? 'BLOCKED' : 'ADVISORY';
        const db2 = await openDb(root);
        const decisionId = randomUUID();
        saveCollaborationDecision(db2, { id: decisionId, sessionId, decision, status, rationale: String(parsed.rationale || ''), conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [], evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [] });
        addCollaborationMessage(db2, { id: `DECISION-MSG-${decisionId}`, sessionId, round: maxRounds, sequence: sequence + 1, agentRole: leadRole, workerId: lead.id, model: lead.model, kind: 'DECISION', content: JSON.stringify({ decision, rationale: String(parsed.rationale || ''), conflicts: parsed.conflicts || [], evidence: parsed.evidence || [] }), confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : undefined });
        addEvidence(db2, { id: `COLLAB-DECISION-EVIDENCE-${decisionId}`, taskId, kind: 'collaboration_decision', status: 'info', payload: { sessionId, decisionId, decision, status, rationale: String(parsed.rationale || ''), conflicts: parsed.conflicts || [], evidence: parsed.evidence || [] } });
        recordEvent(db2, 'collaboration.decision', { sessionId, decisionId, decision, status, rationale: String(parsed.rationale || ''), confidence: Number(parsed.confidence || 0) }, taskId);
        db2.close();
        const consensus = await evaluateConsensus(root, sessionId);
        return { sessionId, taskId, rounds: maxRounds, messages: sent, decision, status, rationale: String(parsed.rationale || ''), conflicts: parsed.conflicts || [], evidence: parsed.evidence || [], consensus };
    }
    catch (error) {
        const db = await openDb(root);
        db.prepare(`UPDATE collaboration_sessions SET status='blocked',last_error=?,updated_at=? WHERE id=?`).run(String(error), new Date().toISOString(), sessionId);
        recordEvent(db, 'collaboration.blocked', { sessionId, error: String(error) }, taskId);
        db.close();
        throw error;
    }
}
export async function collaborationStatusProject(root, sessionId) { const db = await openDb(path.resolve(root)); try {
    return collaborationStatus(db, sessionId);
}
finally {
    db.close();
} }
export async function collaborationHistoryProject(root, taskId) { const db = await openDb(path.resolve(root)); try {
    return collaborationHistory(db, taskId);
}
finally {
    db.close();
} }
