import { createHash } from 'node:crypto';
import path from 'node:path';
import { openDb, memorySearch, memoryForTask, memoryForFailure, saveMemory } from './db.js';
import { git } from './git.js';

export interface MemoryRecord { id:string; kind:string; title:string; content:string; taskId?:string; runId?:string; fingerprint?:string; source:string; confidence?:number; commitSha?:string }

export async function remember(project:string, record:Omit<MemoryRecord,'id'|'commitSha'> & {id?:string}){
  const root=path.resolve(project); const db=await openDb(root);
  try{
    const commitSha=(await git(root,['rev-parse','HEAD']).catch(()=>''))?.trim()||undefined;
    const id=record.id||createHash('sha256').update(JSON.stringify({...record,commitSha})).digest('hex').slice(0,32);
    saveMemory(db,{...record,id,commitSha});
    return {id,commitSha};
  }finally{db.close()}
}
export async function searchMemory(project:string,query:string,limit=20){const db=await openDb(path.resolve(project));try{return memorySearch(db,query,limit)}finally{db.close()}}
export async function taskMemory(project:string,taskId:string,limit=20){const db=await openDb(path.resolve(project));try{return memoryForTask(db,taskId,limit)}finally{db.close()}}
export async function failureMemory(project:string,fingerprint:string,limit=20){const db=await openDb(path.resolve(project));try{return memoryForFailure(db,fingerprint,limit)}finally{db.close()}}
export async function memoryStats(project:string){const db=await openDb(path.resolve(project));try{return db.prepare(`SELECT kind,COUNT(*) count,AVG(confidence) avg_confidence FROM engineering_memory GROUP BY kind ORDER BY count DESC`).all()}finally{db.close()}}
