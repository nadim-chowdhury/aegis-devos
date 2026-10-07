import path from 'node:path';
import {loadConfig, listTasks} from './config.js';
import {openDb, recordEvent} from './db.js';

export interface Opportunity { id:string; kind:string; title:string; rationale:string; value:number; confidence:number; effort:number; score:number; recommended_action:string; }

export async function discoverOpportunities(root:string){
  const config=await loadConfig(root); const tasks=await listTasks(root); const out:Opportunity[]=[];
  const backlog=tasks.filter(t=>t.status!=='done').length;
  if(backlog>12) out.push({id:'opp-backlog',kind:'delivery',title:'Reduce backlog fragmentation',rationale:`There are ${backlog} unfinished tasks; a large queue can reduce focus and increase context switching.`,value:7,confidence:.9,effort:3,score:21,recommended_action:'Group, reprioritize, or decompose the highest-value tasks.'});
  const failed=tasks.filter(t=>t.status==='failed'||t.status==='blocked').length;
  if(failed) out.push({id:'opp-recovery',kind:'reliability',title:'Resolve blocked or failed work',rationale:`${failed} task(s) need recovery before new scope is added.`,value:9,confidence:.95,effort:2,score:42.75,recommended_action:'Run evidence review and create focused debugging tasks.'});
  if(!config.quality?.gates || Object.keys(config.quality.gates).length<2) out.push({id:'opp-quality',kind:'quality',title:'Strengthen automated quality gates',rationale:'The project has limited automated verification configured.',value:8,confidence:.8,effort:4,score:16,recommended_action:'Add typecheck, lint, tests, build, and security gates appropriate to the stack.'});
  if(!config.policy?.protected_paths?.length) out.push({id:'opp-security',kind:'security',title:'Define protected paths',rationale:'Sensitive configuration and CI paths should be explicitly protected from autonomous edits.',value:9,confidence:.85,effort:1,score:76.5,recommended_action:'Configure protected_paths and approval requirements.'});
  out.sort((a,b)=>b.score-a.score);
  const db=await openDb(root); recordEvent(db,'opportunity.scan',{count:out.length,opportunities:out}); db.close();
  return out;
}
