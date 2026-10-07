import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ensureDir,writeText,readText} from './fs.js';
import {loadConfig,loadTask} from './config.js';
import {ensureGitSafe,branch,commit,git} from './git.js';
import {buildContext} from './context.js';
import {route} from './router.js';
import {runWorker} from '../workers/adapters.js';
import {quality} from './quality.js';
import {transition} from './state.js';
import {buildAgentPrompt} from '../agents/prompts.js';
import {acquireLock} from './lock.js';
import {recordHealth,cooldown} from './health.js';
import {enforcePolicy} from './policy.js';
import {securityPreflight} from './security.js';
import {auditRun} from './audit.js';
import {openDb,requestApproval,approve,finishRun,getConversation,saveConversation,saveCheckpoint,addEvidence,recordOutcome,taskEvidence} from './db.js';
import {verifyTask} from './verification.js';
import {runStarted,workerStarted,workerEvent,workerFinished,runFinished} from './telemetry.js';
import type {AgentRole} from '../types.js';
function phase(role:AgentRole){return role==='developer'?'implementing':role==='tester'?'testing':role==='reviewer'?'review':role==='security'?'security_review':role==='debugger'?'debugging':role==='architect'?'planning':'planning'}
export interface RunOptions { isolatedBranch?:string; skipBranchCreation?:boolean; }
export async function runTask(project:string,taskId:string,options:RunOptions={}){
 const root=path.resolve(project),config=await loadConfig(root),task=await loadTask(root,taskId); await ensureGitSafe(root,config.defaults.require_clean_git);
 const security=await securityPreflight(root,config,task); if(!security.ok) throw new Error(`Security preflight failed: ${security.checks.filter(x=>!x.ok).map(x=>x.name).join(', ')}`);
 const runId=`RUN-${Date.now()}-${randomUUID().slice(0,8)}`,dir=path.join(root,'.ai/runs',runId); await ensureDir(dir); const release=await acquireLock(root,runId); let finished=false;
 try{
  await writeText(path.join(dir,'run.json'),JSON.stringify({runId,taskId,status:'starting',startedAt:new Date().toISOString()},null,2)); await runStarted(root,runId,taskId,0); const startDb=await openDb(root); saveCheckpoint(startDb,runId,taskId,'starting',0); startDb.close();
  if(!options.skipBranchCreation){await branch(root,options.isolatedBranch||`aegis/${taskId.toLowerCase()}`);} const context=await buildContext(root,task,config.defaults.max_context_chars); await writeText(path.join(dir,'context.txt'),context); await writeText(path.join(dir,'context.manifest.json'),JSON.stringify({version:'4.0.0',taskId,generatedAt:new Date().toISOString(),maxChars:config.defaults.max_context_chars,includes:['canonical-ai-docs','engineering-memory','relevant-code'],memoryQuery:`${task.title} ${task.objective}`},null,2));
  const db0=await openDb(root); const priorConversation=getConversation(db0,taskId); db0.close();
  let role:AgentRole=task.assigned_role||'developer'; let attempts=0,recoveryAttempts=0; const max=task.max_attempts||config.defaults.max_task_attempts;
  while(attempts<max){ attempts++; const cp=await openDb(root); saveCheckpoint(cp,runId,taskId,'attempt',attempts,{role}); cp.close(); await transition(root,task,phase(role),{runId,attempt:attempts,agent:role}); const candidates=await route(root,task,config,role); if(!candidates.length){await transition(root,task,'blocked',{reason:'No eligible workers',runId});throw new Error('No eligible workers available.')}
   let success=false;
   for(const worker of candidates){
    const workerSecurity=await securityPreflight(root,config,task,worker); if(!workerSecurity.ok){ console.error(`[Aegis] Security rejected worker ${worker.id}: ${workerSecurity.checks.filter(x=>!x.ok).map(x=>x.name).join(', ')}`); continue; }
    console.log(`[Aegis] ${task.id} attempt ${attempts} → ${role} → ${worker.id} (${worker.model})`); await workerStarted(root,runId,taskId,worker.id,worker.model);
    const prior=priorConversation && priorConversation.worker_id===worker.id && priorConversation.model===worker.model ? priorConversation.conversation_id : undefined;
    const prompt=buildAgentPrompt(role,task,context) + (role==='reviewer' ? `\n\nINDEPENDENT REVIEW MODE:\nDo not trust another agent's claims. Inspect git diff, tests, and actual files yourself. Base findings on evidence.` : '');
    const result=await runWorker({projectPath:root,model:worker.model,prompt,timeoutMs:config.defaults.run_timeout_ms,command:worker.command,provider:worker.provider,conversationId:prior,onEvent:e=>{void workerEvent(root,runId,taskId,worker.id,e)}},worker);
    if(result.conversationId){const db=await openDb(root);saveConversation(db,taskId,worker.id,worker.model,result.conversationId);db.close()} await recordHealth(root,worker.id,result); await workerFinished(root,runId,taskId,worker.id,result); const odb=await openDb(root); recordOutcome(odb,{taskId,runId,role,workerId:worker.id,model:worker.model,status:result.success?'success':'failure',durationMs:result.durationMs,attempt:attempts,taskType:task.type,domain:task.domain,risk:task.risk}); addEvidence(odb,{id:`worker-${runId}-${attempts}-${worker.id}`,taskId,runId,kind:role==='reviewer'?'review':role==='security'?'security_review':'worker_execution',status:result.success?'pass':'fail',payload:{worker:worker.id,model:worker.model,role,durationMs:result.durationMs,errorType:result.errorType,turns:result.turns}}); odb.close(); await writeText(path.join(dir,`attempt-${attempts}-${worker.id}.json`),JSON.stringify({...result,role,worker:worker.id},null,2));
    if(result.success){success=true;break} await cooldown(root,worker.id,worker.cooldownSeconds||300);
   }
   if(!success){const fdb=await openDb(root); saveCheckpoint(fdb,runId,taskId,'recovery',attempts,{role,recoveryAttempts:recoveryAttempts+1}); fdb.close(); recoveryAttempts++;if(recoveryAttempts>config.defaults.max_recovery_attempts){await transition(root,task,'failed',{runId,reason:'Worker failures exceeded recovery limit'});throw new Error('Worker recovery limit exceeded.')}role=task.escalation?.role||'debugger';continue}
   if(role==='debugger'){role='tester';continue} if(role==='developer'){role='tester';continue} if(role==='tester'){role='reviewer';continue} if(role==='reviewer'&&(task.risk==='high'||task.risk==='critical')){role='security';continue}
   await transition(root,task,'quality_gate',{runId,attempt:attempts}); const q=await quality(root,config,task.quality_gates||[]); await writeText(path.join(dir,'quality.json'),JSON.stringify(q,null,2)); const qdb=await openDb(root); addEvidence(qdb,{id:`quality-${runId}-${attempts}`,taskId,runId,kind:'quality_gate',status:q.ok?'pass':'fail',payload:q}); qdb.close();
   if(!q.ok){recoveryAttempts++;if(recoveryAttempts>config.defaults.max_recovery_attempts){await transition(root,task,'failed',{runId,reason:'Quality gates repeatedly failed'});throw new Error('Quality gates repeatedly failed.')}role='debugger';continue}
   try{await enforcePolicy(root,task,config)}catch(e){await transition(root,task,'failed',{runId,reason:String(e)});throw e}
   const audit=await auditRun(root,taskId,config); const adb=await openDb(root); addEvidence(adb,{id:`audit-${runId}`,taskId,runId,kind:'audit',status:'pass',payload:audit}); adb.close(); await writeText(path.join(dir,'audit.json'),JSON.stringify(audit,null,2));
   const verification=await verifyTask(root,taskId,runId); await writeText(path.join(dir,'verification.json'),JSON.stringify(verification,null,2));
   if(verification.verdict!=='PASS'){
    await transition(root,task,'blocked',{runId,reason:`Independent verification returned ${verification.verdict}`,verification});
    const vdb=await openDb(root); addEvidence(vdb,{id:`verification-${runId}-${attempts}`,taskId,runId,kind:'verification',status:'fail',payload:verification}); vdb.close();
    if(verification.verdict==='NEED_HUMAN'){const vdb2=await openDb(root);requestApproval(vdb2,taskId,runId);finishRun(vdb2,runId,'awaiting_approval');vdb2.close();await writeText(path.join(dir,'approval.requested.json'),JSON.stringify({runId,taskId,reason:'Independent verification requires human decision',verification,requestedAt:new Date().toISOString()},null,2));return;}
    throw new Error(`Verification did not pass: ${verification.verdict}.`);
   }
   const vdb=await openDb(root); addEvidence(vdb,{id:`verification-${runId}-${attempts}`,taskId,runId,kind:'verification',status:'pass',payload:verification}); vdb.close();
   if(task.human_approval||(config.policy?.require_review_for||[]).includes(task.risk||'low')){await transition(root,task,'blocked',{reason:'Human approval required before completion',runId});const db=await openDb(root);requestApproval(db,taskId,runId);finishRun(db,runId,'awaiting_approval');db.close();await writeText(path.join(dir,'approval.requested.json'),JSON.stringify({runId,taskId,requestedAt:new Date().toISOString(),audit},null,2));return}
   if(config.defaults.auto_commit){const diff=await git(root,['diff','--stat','HEAD']);if(diff)await commit(root,`aegis(${taskId}): ${task.title}`)}
   const ddb=await openDb(root); saveCheckpoint(ddb,runId,taskId,'done',attempts,{quality:q,audit}); ddb.close(); await transition(root,task,'done',{runId,attempt:attempts,finishedAt:new Date().toISOString()});await writeText(path.join(dir,'run.json'),JSON.stringify({runId,taskId,status:'done',attempt:attempts,finishedAt:new Date().toISOString()},null,2));await runFinished(root,runId,'done',taskId);finished=true;return;
  }
  await transition(root,task,'failed',{runId,reason:'Maximum attempts exceeded'});throw new Error(`Task ${taskId} failed after ${max} attempts.`);
 }catch(e){if(!finished){try{await runFinished(root,runId,'failed',taskId,{reason:String(e)})}catch{} await writeText(path.join(dir,'run.json'),JSON.stringify({runId,taskId,status:'failed',error:String(e),finishedAt:new Date().toISOString()},null,2)).catch(()=>{});}throw e}finally{await release()}
}
export async function approveTask(project:string,taskId:string){
 const root=path.resolve(project),task=await loadTask(root,taskId),config=await loadConfig(root);
 const files=await import('node:fs/promises');
 const runs=await files.readdir(path.join(root,'.ai/runs')).catch(()=>[] as string[]);
 for(const id of runs.filter(x=>x.startsWith('RUN-')).reverse()){
  const p=path.join(root,'.ai/runs',id,'approval.requested.json');
  try{
   const data=JSON.parse(await readText(p));
   if(data.taskId!==taskId)continue;
   if(config.defaults.auto_commit){const diff=await git(root,['diff','--stat','HEAD']);if(diff)await commit(root,`aegis(${taskId}): ${task.title}`)}
   task.status='done';
   const db=await openDb(root);approve(db,taskId);finishRun(db,id,'approved');db.close();
   await transition(root,task,'done',{approvedBy:'human',runId:id,finishedAt:new Date().toISOString()});
   await writeText(path.join(root,'.ai/runs',id,'approval.approved.json'),JSON.stringify({approvedAt:new Date().toISOString()},null,2));
   return;
  }catch{}
 }
 throw new Error(`No pending approval found for ${taskId}.`);
}
export async function status(project:string){const root=path.resolve(project);const s=await git(root,['status','--short']);let state='No STATE.md';try{state=await readText(path.join(root,'.ai/STATE.md'))}catch{}console.log(`Git:\n${s||'clean'}\n\nSTATE:\n${state}`)}
