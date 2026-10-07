import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, mkdir, stat, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openDb } from './db.js';
import { atomicProjectLock, beginIdempotentOperation, completeIdempotentOperation, scheduleRetry, clearRetry, ensureOperationsSchema } from './operations.js';
import { appendEvent, consumeEventsOnce, listEventStream } from './event-bus.js';

export type ReliabilityStatus = 'pass'|'fail'|'skip';
export interface ReliabilityCheck { id:string; name:string; status:ReliabilityStatus; durationMs:number; details?:unknown; error?:string; }
export interface ReliabilityReport { suiteId:string; startedAt:string; finishedAt:string; status:ReliabilityStatus; checks:ReliabilityCheck[]; summary:{passed:number;failed:number;skipped:number}; safe:true; }

async function check(id:string,name:string,fn:()=>Promise<unknown>):Promise<ReliabilityCheck>{
 const started=Date.now();
 try{return {id,name,status:'pass',durationMs:Date.now()-started,details:await fn()};}
 catch(error){return {id,name,status:'fail',durationMs:Date.now()-started,error:error instanceof Error?error.message:String(error)};}
}

async function setupProject(root:string){
 await mkdir(path.join(root,'.ai'),{recursive:true});
 await mkdir(path.join(root,'.aegis'),{recursive:true});
 await writeFile(path.join(root,'.aegis','config.yaml'),'defaults:\n  max_task_attempts: 3\n  require_clean_git: false\n  auto_commit: false\n  auto_merge: false\n  daemon_interval_seconds: 60\n  max_context_chars: 10000\n  run_timeout_ms: 10000\n  max_recovery_attempts: 2\n  heartbeat_interval_seconds: 5\n  max_parallel_workers: 1\nworkers: []\n','utf8');
}

async function lockContention(root:string){
 const first=await atomicProjectLock(root,'reliability-owner',60_000);
 let blocked=false;
 try { await atomicProjectLock(root,'reliability-contender',60_000); }
 catch { blocked=true; }
 await first();
 if(!blocked) throw new Error('Concurrent project lock was not rejected');
 return {contentionRejected:true};
}

async function staleLockRecovery(root:string){
 const lock=path.join(root,'.ai','.aegis.lock');
 await writeFile(lock,JSON.stringify({operationId:'stale',pid:999999,host:'chaos-test',createdAt:new Date(Date.now()-2*60*60_000).toISOString()}),'utf8');
 const release=await atomicProjectLock(root,'recovery-owner',1_000);
 const owner=JSON.parse(await readFile(lock,'utf8'));
 await release();
 if(owner.operationId!=='recovery-owner') throw new Error('Stale lock was not replaced safely');
 return {recovered:true};
}

async function idempotencyReplay(root:string){
 const db=await openDb(root); try {
   ensureOperationsSchema(db);
   const a=beginIdempotentOperation(db,'reliability','duplicate-key');
   const b=beginIdempotentOperation(db,'reliability','duplicate-key');
   completeIdempotentOperation(db,'reliability','duplicate-key',{ok:true,value:42});
   const c=beginIdempotentOperation(db,'reliability','duplicate-key');
   if(a.existing||!b.existing||!c.existing||c.status!=='completed'||c.response?.value!==42) throw new Error('Idempotency replay semantics failed');
   return {firstOwner:!a.existing,duplicatesRejected:b.existing,completedReplay:c.response};
 } finally { db.close(); }
}

async function retryBounds(root:string){
 const db=await openDb(root); try {
   ensureOperationsSchema(db);
   const low=scheduleRetry(db,'low',1,new Error('x'),10,40);
   const high=scheduleRetry(db,'high',20,new Error('x'),10,40);
   clearRetry(db,'low');
   const row:any=db.prepare('SELECT * FROM retry_state WHERE operation_id=?').get('high');
   if(low.delayMs!==10||high.delayMs!==40||!row||Number(row.attempts)!==20) throw new Error('Retry bounds failed');
   return {firstDelayMs:low.delayMs,boundedDelayMs:high.delayMs,attempt:Number(row.attempts)};
 } finally { db.close(); }
}

async function eventDurability(root:string){
 const db=await openDb(root); try {
   appendEvent(db,{type:'reliability:test',producer:'reliability',payload:{nonce:randomUUID()}});
   appendEvent(db,{type:'reliability:test',producer:'reliability',payload:{value:2}});
 } finally { db.close(); }
 const before=await listEventStream(root,0,10,'reliability:test');
 const dry=await consumeEventsOnce(root,'reliability-consumer',10,false);
 const replay=await consumeEventsOnce(root,'reliability-consumer',10,false);
 const ack=await consumeEventsOnce(root,'reliability-consumer',10,true);
 const after=await consumeEventsOnce(root,'reliability-consumer',10,true);
 if(before.length!==2||dry.events.length!==2||replay.events.length!==2||ack.events.length!==2||after.events.length!==0) throw new Error('Event replay/ack semantics failed');
 return {events:before.length,replayPreserved:true,acknowledged:ack.lastSequence};
}

async function dbRestart(root:string){
 const db=await openDb(root); try { db.prepare('INSERT INTO events(type,payload_json,created_at) VALUES(?,?,?)').run('reliability','{"ok":true}',new Date().toISOString()); } finally { db.close(); }
 const db2=await openDb(root); try { const row:any=db2.prepare("SELECT COUNT(*) AS n FROM events WHERE type='reliability'").get(); if(Number(row.n)!==1) throw new Error('Durable DB state was not recovered after close/reopen'); return {rows:Number(row.n)}; } finally { db2.close(); }
}

export async function runReliabilitySuite(projectRoot:string):Promise<ReliabilityReport>{
 const startedAt=new Date().toISOString(); const suiteId=randomUUID(); const root=await mkdtemp(path.join(os.tmpdir(),'aegis-reliability-'));
 const checks:ReliabilityCheck[]=[];
 try {
   await setupProject(root);
   checks.push(await check('LOCK-CONTENTION','Concurrent project lock rejection',()=>lockContention(root)));
   checks.push(await check('LOCK-STALE-RECOVERY','Stale lock recovery',()=>staleLockRecovery(root)));
   checks.push(await check('IDEMPOTENCY-REPLAY','Idempotent operation replay',()=>idempotencyReplay(root)));
   checks.push(await check('RETRY-BOUNDS','Retry/backoff bounds',()=>retryBounds(root)));
   checks.push(await check('EVENT-DURABILITY','Event replay and acknowledgement',()=>eventDurability(root)));
   checks.push(await check('DB-RESTART','Database close/reopen durability',()=>dbRestart(root)));
 } finally { await rm(root,{recursive:true,force:true}); }
 const passed=checks.filter(c=>c.status==='pass').length, failed=checks.filter(c=>c.status==='fail').length, skipped=checks.filter(c=>c.status==='skip').length;
 const report:ReliabilityReport={suiteId,startedAt,finishedAt:new Date().toISOString(),status:failed?'fail':'pass',checks,summary:{passed,failed,skipped},safe:true};
 return report;
}

export async function persistReliabilityReport(projectRoot:string,report:ReliabilityReport){
 const dir=path.join(projectRoot,'.aegis','reliability'); await mkdir(dir,{recursive:true});
 const target=path.join(dir,`${report.suiteId}.json`); const tmp=`${target}.tmp-${process.pid}`;
 await writeFile(tmp,JSON.stringify(report,null,2),'utf8'); await rename(tmp,target);
 await writeFile(path.join(dir,'latest.json'),JSON.stringify(report,null,2),'utf8');
 return target;
}

export async function reliabilityStatus(projectRoot:string){
 try { return JSON.parse(await readFile(path.join(projectRoot,'.aegis','reliability','latest.json'),'utf8')); }
 catch { return {status:'unknown',message:'No reliability suite has been executed.'}; }
}

export async function reliabilityHistory(projectRoot:string){
 const dir=path.join(projectRoot,'.aegis','reliability');
 try { const names=await (await import('node:fs/promises')).readdir(dir); const reports=[]; for(const n of names.filter((x:string)=>x.endsWith('.json')&&x!=='latest.json').sort().reverse().slice(0,50)){try{reports.push(JSON.parse(await readFile(path.join(dir,n),'utf8')))}catch{}} return reports; }
 catch { return []; }
}
