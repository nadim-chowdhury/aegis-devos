import path from 'node:path';
import { listTasks, loadConfig } from './config.js';
import { discoverOpportunities } from './opportunities.js';
import { portfolioReport } from './portfolio.js';
import { openDb } from './db.js';
import { codeGraphStats } from './code-graph.js';

export interface FactoryRecommendation {
  id:string;
  priority:number;
  kind:'delivery'|'recovery'|'quality'|'security'|'architecture'|'routing'|'planning';
  title:string;
  rationale:string;
  evidence:string[];
  action:string;
}

export async function factoryIntelligence(project:string){
  const root=path.resolve(project);
  const config=await loadConfig(root);
  const tasks=await listTasks(root);
  const health=await (await import('./health.js')).loadHealth(root);
  const opportunities=await discoverOpportunities(root);
  const graph=await codeGraphStats(root).catch(()=>({files:0,symbols:0,edges:0}));
  const db=await openDb(root);
  let routing:any[]=[]; let learning:any[]=[]; let verifications:any[]=[]; let failures:any[]=[];
  try {
    routing=db.prepare('SELECT * FROM routing_decisions ORDER BY id DESC LIMIT 25').all();
    learning=db.prepare('SELECT * FROM learning_insights ORDER BY confidence DESC,success_rate DESC LIMIT 25').all();
    verifications=db.prepare('SELECT * FROM verification_evaluations ORDER BY created_at DESC LIMIT 25').all();
    failures=db.prepare('SELECT * FROM failure_fingerprints ORDER BY updated_at DESC LIMIT 25').all();
  } finally { db.close(); }
  const recs:FactoryRecommendation[]=[];
  const ready=tasks.filter(t=>t.status==='ready').sort((a,b)=>(b.priority??0)-(a.priority??0));
  if(ready[0]) recs.push({id:`delivery:${ready[0].id}`,priority:90,kind:'delivery',title:`Execute ready task: ${ready[0].title}`,rationale:'A ready task is already defined and can be independently verified.',evidence:[`task=${ready[0].id}`,`priority=${ready[0].priority??0}`],action:`Run ${ready[0].id}.`});
  const blocked=tasks.filter(t=>['blocked','failed'].includes(t.status));
  if(blocked.length) recs.push({id:'recovery:blocked',priority:100,kind:'recovery',title:'Resolve blocked or failed work first',rationale:`${blocked.length} task(s) are blocked or failed; adding scope before recovery increases execution risk.`,evidence:[`blocked_or_failed=${blocked.length}`],action:'Inspect failure history and create focused recovery work.'});
  if((config.policy?.protected_paths?.length??0)===0) recs.push({id:'security:protected-paths',priority:98,kind:'security',title:'Define protected paths',rationale:'Autonomous edits should explicitly protect sensitive configuration and deployment paths.',evidence:['protected_paths=0'],action:'Configure protected_paths and approval requirements.'});
  if(Object.keys(config.quality?.gates||{}).length<2) recs.push({id:'quality:gates',priority:82,kind:'quality',title:'Strengthen automated quality gates',rationale:'The current gate set provides limited automated evidence.',evidence:[`quality_gates=${Object.keys(config.quality?.gates||{}).length}`],action:'Add appropriate typecheck, lint, test, build, and security gates.'});
  const unhealthy=Object.values(health).filter((h:any)=>h.consecutiveFailures>0).length;
  if(unhealthy) recs.push({id:'routing:unhealthy',priority:88,kind:'routing',title:'Review unhealthy workers',rationale:`${unhealthy} worker(s) have consecutive failures and should not receive blind preference.`,evidence:[`unhealthy_workers=${unhealthy}`],action:'Prefer healthy alternatives or route with stronger review.'});
  if(graph.files===0 && tasks.length) recs.push({id:'architecture:index',priority:70,kind:'architecture',title:'Index the codebase before broad changes',rationale:'No persistent code graph is available for impact analysis.',evidence:['code_graph_files=0'],action:'Run aegis code-index before planning broad refactors.'});
  const failedPatterns=failures.filter(f=>Number(f.sample_count||0)>=2 && Number(f.success_count||0)===0);
  if(failedPatterns.length) recs.push({id:'planning:repeat-failures',priority:92,kind:'planning',title:'Account for repeated failure patterns',rationale:'Historical failure fingerprints show repeated unsuccessful recovery.',evidence:[`repeated_unsuccessful_patterns=${failedPatterns.length}`],action:'Replan with targeted mitigation and stronger verification.'});
  const weakLearning=learning.filter(x=>Number(x.confidence||0)>=.4 && Number(x.success_rate||0)<.6);
  if(weakLearning.length) recs.push({id:'routing:weak-evidence',priority:76,kind:'routing',title:'Use conservative routing for weak historical performers',rationale:'Learning evidence contains comparable contexts with low success rates.',evidence:[`weak_learning_profiles=${weakLearning.length}`],action:'Prefer alternatives or stronger review for matching tasks.'});
  const needsVerify=verifications.filter(v=>v.verdict!=='PASS').length;
  if(needsVerify) recs.push({id:'verification:attention',priority:95,kind:'recovery',title:'Resolve non-passing verification evidence',rationale:'Recent verification records contain unresolved non-pass outcomes.',evidence:[`non_pass_verifications=${needsVerify}`],action:'Do not expand scope until affected work is verified or explicitly escalated.'});
  recs.push(...opportunities.slice(0,5).map(o=>({id:`opportunity:${o.id}`,priority:Math.min(75,Math.round(o.score)),kind:o.kind==='security'?'security':o.kind==='quality'?'quality':o.kind==='reliability'?'recovery':'planning',title:o.title,rationale:o.rationale,evidence:[`opportunity_score=${o.score}`,`confidence=${o.confidence}`],action:o.recommended_action})));
  recs.sort((a,b)=>b.priority-a.priority);
  const portfolio=await portfolioReport(path.resolve(root,'..')).catch(()=>undefined);
  return {generated_at:new Date().toISOString(),project:root,health_worker_count:Object.keys(health).length,code_graph:graph,tasks:{total:tasks.length,ready:ready.length,blocked_or_failed:blocked.length},evidence:{routing: routing.length,learning:learning.length,verification:verifications.length,failure_patterns:failures.length},portfolio_products:portfolio?.products?.length??1,recommendations:recs.slice(0,15)};
}
