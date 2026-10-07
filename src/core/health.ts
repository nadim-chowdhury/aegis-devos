import path from 'node:path';
import {ensureDir,exists,readText,writeText} from './fs.js';
import type {WorkerHealth,WorkerResult} from '../types.js';

function file(root:string){return path.join(root,'.aegis','worker-health.json')}
export async function loadHealth(root:string):Promise<Record<string,WorkerHealth>>{
  try{return JSON.parse(await readText(file(root)))}catch{return {}}
}
export async function recordHealth(root:string,workerId:string,result:WorkerResult){
  const all=await loadHealth(root); const old=all[workerId]||{workerId,successes:0,failures:0,consecutiveFailures:0};
  if(result.success){old.successes++;old.consecutiveFailures=0;old.lastSuccess=new Date().toISOString();old.avgDurationMs=old.avgDurationMs?Math.round((old.avgDurationMs+result.durationMs)/2):result.durationMs;delete old.cooldownUntil}
  else{old.failures++;old.consecutiveFailures++;old.lastFailure=new Date().toISOString()}
  all[workerId]=old; await ensureDir(path.dirname(file(root))); await writeText(file(root),JSON.stringify(all,null,2));
}
export function isCoolingDown(h?:WorkerHealth){return !!h?.cooldownUntil && new Date(h.cooldownUntil).getTime()>Date.now()}
export async function cooldown(root:string,workerId:string,seconds:number){const all=await loadHealth(root);const h=all[workerId]||{workerId,successes:0,failures:0,consecutiveFailures:0};h.cooldownUntil=new Date(Date.now()+seconds*1000).toISOString();all[workerId]=h;await ensureDir(path.dirname(file(root)));await writeText(file(root),JSON.stringify(all,null,2));}
