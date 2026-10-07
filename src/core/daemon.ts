import path from 'node:path';
import {listTasks,loadConfig} from './config.js';
import {runTask} from './run.js';
import {openDb,recoverStaleRuns} from './db.js';
import {syncProject} from './sync.js';

function ready(t:any,all:any[]){return t.status==='ready' && (t.depends_on||[]).every((id:string)=>all.some(x=>x.id===id&&x.status==='done'))}
export async function nextTask(project:string){const root=path.resolve(project);const tasks=await listTasks(root);return tasks.filter(t=>ready(t,tasks)).sort((a,b)=>(b.priority||0)-(a.priority||0))[0]}
export async function daemon(project:string,once=false){const root=path.resolve(project);const config=await loadConfig(root);console.log(`[Aegis] daemon started: ${root}`);do{await syncProject(root);const db=await openDb(root);const stale=recoverStaleRuns(db,Math.max(config.defaults.run_timeout_ms*2,600000));if(stale.length)console.log(`[Aegis] recovered ${stale.length} stale run(s).`);db.close();const task=await nextTask(root);if(task){console.log(`[Aegis] next task: ${task.id} — ${task.title}`);try{await runTask(root,task.id)}catch(e){console.error(`[Aegis] task failed: ${e instanceof Error?e.message:e}`)}}else console.log('[Aegis] no ready tasks.');if(!once)await new Promise(r=>setTimeout(r,config.defaults.daemon_interval_seconds*1000));}while(!once)}
