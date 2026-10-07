import path from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import YAML from 'yaml';
import {openDb,startRecovery,completeRecovery} from './db.js';
import type {Task,AgentRole} from '../types.js';

function taskFile(root:string,id:string){return path.join(root,'.ai/tasks',`${id}.yaml`)}
function readTaskSync(root:string,id:string):Task{return YAML.parse(readFileSync(taskFile(root,id),'utf8')) as Task;}
function saveTaskSync(root:string,t:Task){writeFileSync(taskFile(root,t.id),YAML.stringify(t));}

export async function activateRecovery(project:string,requestId:string){
 const root=path.resolve(project),db=await openDb(root);
 try{
  const row=db.prepare('SELECT * FROM recovery_requests WHERE id=?').get(requestId) as any;
  if(!row)return {status:'missing'};
  if(row.status!=='scheduled')return {status:row.status};
  if(!startRecovery(db,requestId))return {status:'budget_exhausted'};
  const task=readTaskSync(root,row.task_id);
  task.status='ready';
  task.assigned_role=(task.escalation?.role||'debugger') as AgentRole;
  task.generated_by='recovery-orchestrator';
  saveTaskSync(root,task);
  db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run('ready',new Date().toISOString(),task.id);
  return {status:'activated',taskId:task.id,role:task.assigned_role,attempts:row.attempts+1,maxAttempts:row.max_attempts};
 }catch(e){completeRecovery(db,requestId,'failed',String(e));throw e;}finally{db.close();}
}

export async function recoveryStatus(project:string,taskId?:string){
 const db=await openDb(path.resolve(project));
 try{return taskId?db.prepare('SELECT * FROM recovery_requests WHERE task_id=? ORDER BY created_at DESC').all(taskId):db.prepare('SELECT * FROM recovery_requests ORDER BY updated_at DESC').all();}finally{db.close();}
}
