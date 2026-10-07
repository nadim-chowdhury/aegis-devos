import os from 'node:os';
import path from 'node:path';
import {loadConfig} from './config.js';
import {openDb,acquireWorkerLease,heartbeatWorkerLease,releaseWorkerLease,claimReadyTask,renewTaskClaim,releaseTaskClaim,recoverStaleWorkerLeases,workerRuntimeSummary} from './db.js';
import {runTask} from './run.js';
import {consumeEventsOnce} from './event-bus.js';

export interface RuntimeOptions { workerId:string; once?:boolean; leaseMs?:number; pollMs?:number; }

export async function runtimeStatus(project:string){
  const db=await openDb(path.resolve(project));
  try{return workerRuntimeSummary(db);}finally{db.close();}
}

export async function workerRuntime(project:string,options:RuntimeOptions){
  const root=path.resolve(project); const config=await loadConfig(root);
  const worker=config.workers.find(w=>w.id===options.workerId);
  if(!worker) throw new Error(`Worker not configured: ${options.workerId}`);
  if(worker.enabled===false) throw new Error(`Worker is disabled: ${worker.id}`);
  const leaseMs=Math.max(5000,options.leaseMs??Math.max(config.defaults.heartbeat_interval_seconds*3000,30000));
  const pollMs=Math.max(500,options.pollMs??Math.max(1000,config.defaults.daemon_interval_seconds*1000));
  const db=await openDb(root);
  acquireWorkerLease(db,worker.id,process.pid,os.hostname(),leaseMs);
  let stopping=false;

  const stop=()=>{stopping=true;};
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  const heartbeat=setInterval(()=>{if(stopping)return;try{heartbeatWorkerLease(db,worker.id,leaseMs);}catch{stopping=true;}},Math.max(1000,Math.floor(leaseMs/3)));
  const stale=recoverStaleWorkerLeases(db,leaseMs*2);
  if(stale.length) console.log(`[Aegis] recovered ${stale.length} stale worker lease(s).`);
  try{
    do{
      if(stopping) break;
      const claim=claimReadyTask(db,worker.id,leaseMs);
      if(!claim){
        if(options.once) break;
        const observed=await consumeEventsOnce(root,`runtime:${worker.id}`,50,true);
        const wake=observed.events.some((event:any)=>event.type==='WORKER_WAKE_REQUEST' || event.type==='TASK_READY');
        if(!wake) await new Promise(r=>setTimeout(r,pollMs));
        continue;
      }
      console.log(`[Aegis] worker ${worker.id} claimed ${claim.taskId}`);
      const claimHeartbeat=setInterval(()=>{try{renewTaskClaim(db,worker.id,claim.taskId,leaseMs);}catch{}},Math.max(1000,Math.floor(leaseMs/3)));
      try{
        await runTask(root,claim.taskId);
      }catch(e){
        console.error(`[Aegis] worker ${worker.id} task ${claim.taskId} failed: ${e instanceof Error?e.message:e}`);
      }finally{
        clearInterval(claimHeartbeat);
        releaseTaskClaim(db,worker.id,claim.taskId);
      }
      if(options.once) break;
    }while(!stopping);
  }finally{
    clearInterval(heartbeat);
    releaseWorkerLease(db,worker.id);
    db.close();
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
  }
}
