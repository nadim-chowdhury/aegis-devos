#!/usr/bin/env node
import path from 'node:path';
import {Command} from 'commander';
import YAML from 'yaml';
import {exists,ensureDir,writeText} from './core/fs.js';
import {runTask,status,approveTask} from './core/run.js';
import {runFactory,factoryStatus,factoryHistory} from './core/factory.js';
import {factoryIntelligence} from './core/factory-intelligence.js';import {daemon,nextTask} from './core/daemon.js';
import {decompose} from './core/decompose.js';
import {doctor} from './core/doctor.js';
import {loadConfig,listTasks} from './core/config.js';
import {syncProject} from './core/sync.js';
import {dashboard} from './core/dashboard.js';
import {orchestrate} from './core/orchestrator.js';
import {executeParallel} from './core/worktrees.js';
import {verifyMesh} from './core/verification-mesh.js';
import {openDb,dbSummary,workerScoreSummary,taskEvidence,routingSummary} from './core/db.js';
import {planProject} from './core/strategy.js';
import {discoverOpportunities} from './core/opportunities.js';
import {productHealth, saveSignals, proposeExperiment} from './core/intelligence.js';
import {portfolioReport, nextBestActions} from './core/portfolio.js';
import {growthReport, updateExperiment} from './core/growth.js';
import {learn} from './core/learning.js';
import {verifyTask} from './core/verification.js';
import {replanProject,replanStatus,approveReplan} from './core/replanning.js';
import {routingReport} from './core/router.js';
import {workerRuntime,runtimeStatus} from './core/runtime.js';
import {eventStatus, listEventStream, publishEvent, consumeEventsOnce} from './core/event-bus.js';
import {controlLoop} from './core/control-plane.js';
import {failureHistory} from './core/failure-intelligence.js';
import {searchMemory,taskMemory,failureMemory,remember,memoryStats} from './core/memory.js';
import {recoveryStatus} from './core/recovery.js';
import {indexCodebase,codeGraphStats,codeImpact,codeContextForTask} from './core/code-graph.js';
import {collaborateProject,collaborationStatusProject,collaborationHistoryProject} from './core/collaboration.js';import {evaluateConsensus,consensusStatusProject} from './core/consensus.js';
import {resourcePlan,resourceRecommendations,resourceHistory} from './core/resource-intelligence.js';
import {ensureOperationsSchema,healthReport,operationStatus} from './core/operations.js';
import {capacityPlan,capacityRecommendations,capacityHistory} from './core/capacity-intelligence.js';
import {checkWorker} from './workers/adapters.js';
import {securityPreflight} from './core/security.js';
import {collectObservability,observabilityStatus,tailLogs,writeLog} from './core/observability.js';
import {productionReadiness,databaseBackup,verifyDatabaseBackup,restoreDatabase} from './core/release.js';

const program=new Command();
program.name('aegis').description('Aegis DevOS autonomous engineering orchestrator').version('7.0.1');
program.command('init <project>').action(async project=>{const root=path.resolve(project);await ensureDir(path.join(root,'.ai/tasks'));await ensureDir(path.join(root,'.ai/runs'));await ensureDir(path.join(root,'.aegis'));if(!(await exists(path.join(root,'.aegis/config.yaml'))))await writeText(path.join(root,'.aegis/config.yaml'),YAML.stringify({defaults:{max_task_attempts:3,require_clean_git:true,auto_commit:true,auto_merge:false,daemon_interval_seconds:60,max_context_chars:50000,run_timeout_ms:900000,max_recovery_attempts:2,heartbeat_interval_seconds:15,resource_budget:10,max_parallel_workers:1},workers:[{id:'gemini-fast',provider:'antigravity',model:'gemini-3.8-flash-high',capabilities:['frontend','backend','testing','documentation'],enabled:true,cooldownSeconds:300,reliability:.8,quality:.8,cost:.2},{id:'claude-opus',provider:'antigravity',model:'claude-opus-4.6',capabilities:['architecture','security','debugging','code-review'],enabled:true,cooldownSeconds:300,reliability:.9,quality:.95,cost:.7}],routing:{developer:{preferred:['gemini-fast']},tester:{preferred:['gemini-fast']},architect:{preferred:['claude-opus']},security:{preferred:['claude-opus']},reviewer:{preferred:['claude-opus']},debugger:{preferred:['claude-opus']}},policy:{protected_paths:['.env','.github/workflows/'],max_changed_files:100,require_review_for:['critical']},quality:{gates:{typecheck:{command:'npm run typecheck',required:false},lint:{command:'npm run lint',required:false},test:{command:'npm test',required:false},build:{command:'npm run build',required:false}}}}));await writeText(path.join(root,'.ai/PROJECT.md'),'# Project\n\nDefine project identity, stack, deployment and constraints.\n');await writeText(path.join(root,'.ai/STATE.md'),'# Aegis State\n\n- **status**: initialized\n');console.log(`Initialized Aegis in ${root}`)});
program.command('status').requiredOption('-p, --project <path>').action(o=>status(o.project));
program.command('tasks').requiredOption('-p, --project <path>').action(async o=>{for(const t of await listTasks(path.resolve(o.project)))console.log(`${t.id}\t${t.status}\t${t.priority||0}\t${t.title}`)});
program.command('next').requiredOption('-p, --project <path>').action(async o=>{const t=await nextTask(o.project);console.log(t?`${t.id}\t${t.title}`:'No ready tasks.')});
program.command('decompose <task>').requiredOption('-p, --project <path>').action(async(task,o)=>{try{const tasks=await decompose(path.resolve(o.project),task);console.log(`Created ${tasks.length} child tasks.`)}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('plan <goal>').requiredOption('-p, --project <path>').action(async(goal,o)=>{try{const r=await planProject(path.resolve(o.project),goal);console.log(`Created ${r.created.length} tasks across ${r.milestones.length} milestone(s).`)}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('opportunities').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await discoverOpportunities(path.resolve(o.project)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('signals').requiredOption('-p, --project <path>').requiredOption('--file <path>','YAML file containing {signals:[...]}').action(async o=>{try{const fs=await import('node:fs/promises');const data=YAML.parse(await fs.readFile(path.resolve(o.file),'utf8'));await saveSignals(path.resolve(o.project),data.signals||[]);console.log(`Imported ${(data.signals||[]).length} product signal(s).`)}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('product-health').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await productHealth(path.resolve(o.project)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('experiment <hypothesis>').requiredOption('-p, --project <path>').requiredOption('--metric <name>').option('--target <number>').action(async(hypothesis,o)=>{try{const r=await proposeExperiment(path.resolve(o.project),hypothesis,o.metric,o.target===undefined?undefined:Number(o.target));console.log(JSON.stringify(r,null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('growth-report').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await growthReport(path.resolve(o.project)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('experiment-status <id>').requiredOption('-p, --project <path>').requiredOption('--status <status>').option('--observed <number>').action(async(id,o)=>{try{const r=await updateExperiment(path.resolve(o.project),id,o.status,o.observed===undefined?undefined:Number(o.observed));console.log(JSON.stringify(r,null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('portfolio').requiredOption('-r, --root <path>').action(async o=>{try{console.log(JSON.stringify(await portfolioReport(path.resolve(o.root)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('next-action').requiredOption('-r, --root <path>').option('-n, --limit <number>','number of actions','10').action(async o=>{try{console.log(JSON.stringify(await nextBestActions(path.resolve(o.root),Number(o.limit)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('run <task>').requiredOption('-p, --project <path>').action(async(task,o)=>{try{await runTask(o.project,task)}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('approve <task>').requiredOption('-p, --project <path>').action(async(task,o)=>{try{await approveTask(o.project,task);console.log(`Approved ${task}.`)}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('orchestrate').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await orchestrate(path.resolve(o.project)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('factory').requiredOption('-p, --project <path>').option('--goal <goal>').option('--max-tasks <n>','maximum tasks','20').option('--max-parallel <n>','maximum parallel workers','1').option('--max-recovery <n>','maximum recovery attempts','2').option('--max-collaboration <n>','maximum collaboration rounds','3').option('--max-wall-clock-ms <n>','wall-clock budget','3600000').option('--max-replans <n>','maximum replans','1').option('--resume','resume persisted non-terminal factory run').action(async o=>{try{console.log(JSON.stringify(await runFactory(path.resolve(o.project),{goal:o.goal,resume:Boolean(o.resume),budget:{maxTasks:Number(o.maxTasks),maxParallelWorkers:Number(o.maxParallel),maxRecoveryAttempts:Number(o.maxRecovery),maxCollaborationRounds:Number(o.maxCollaboration),maxWallClockMs:Number(o.maxWallClockMs),maxReplans:Number(o.maxReplans)}}),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('factory-status').requiredOption('-p, --project <path>').action(async o=>{console.log(JSON.stringify(await factoryStatus(o.project),null,2));});
program.command('factory-intelligence').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await factoryIntelligence(o.project),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('factory-history').requiredOption('-p, --project <path>').option('-n, --limit <number>','number of runs','20').action(async o=>{console.log(JSON.stringify(await factoryHistory(o.project,Number(o.limit)),null,2));});
program.command('parallel').requiredOption('-p, --project <path>').option('-c, --concurrency <n>','maximum isolated workers','2').action(async o=>{try{console.log(JSON.stringify(await executeParallel(path.resolve(o.project),Math.max(1,Number(o.concurrency)||2)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('verify-mesh').requiredOption('-p, --project <path>').option('--task <id>','task context for policy/scope checks').action(async o=>{try{const r=await verifyMesh(path.resolve(o.project),o.task);console.log(JSON.stringify(r,null,2));if(r.verdict!=='PASS')process.exitCode=1}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('replan').requiredOption('-p, --project <path>').option('--trigger <text>','observed event or reason for replanning','manual').action(async o=>{try{console.log(JSON.stringify(await replanProject(path.resolve(o.project),o.trigger),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('replan-status').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await replanStatus(path.resolve(o.project)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('approve-replan <id>').requiredOption('-p, --project <path>').action(async(id,o)=>{try{console.log(JSON.stringify(await approveReplan(path.resolve(o.project),id),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('collaborate').requiredOption('-p, --project <path>').requiredOption('--task <id>').option('--max-rounds <n>','bounded collaboration rounds','3').option('--max-messages <n>','bounded specialist messages','12').action(async o=>{try{console.log(JSON.stringify(await collaborateProject(path.resolve(o.project),o.task,{maxRounds:Number(o.maxRounds),maxMessages:Number(o.maxMessages)}),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('collaboration-status').requiredOption('-p, --project <path>').option('--session <id>','session id').action(async o=>{try{console.log(JSON.stringify(await collaborationStatusProject(path.resolve(o.project),o.session),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('collaboration-history').requiredOption('-p, --project <path>').option('--task <id>','filter by task').action(async o=>{try{console.log(JSON.stringify(await collaborationHistoryProject(path.resolve(o.project),o.task),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('consensus').requiredOption('-p, --project <path>').requiredOption('--session <id>').action(async o=>{try{console.log(JSON.stringify(await evaluateConsensus(path.resolve(o.project),o.session),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('consensus-status').requiredOption('-p, --project <path>').option('--session <id>','filter by session').action(async o=>{try{console.log(JSON.stringify(await consensusStatusProject(path.resolve(o.project),o.session),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('resource-plan <task>').requiredOption('-p, --project <path>').action(async(task,o)=>{try{const root=path.resolve(o.project);const t=(await listTasks(root)).find(x=>x.id===task);if(!t)throw new Error(`Task not found: ${task}`);console.log(JSON.stringify(await resourcePlan(root,t),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('resource-recommendations').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await resourceRecommendations(o.project),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('resource-history').requiredOption('-p, --project <path>').option('--task <id>','filter by task').action(async o=>{try{console.log(JSON.stringify(await resourceHistory(o.project,o.task),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('daemon').requiredOption('-p, --project <path>').option('--once','run one cycle').action(async o=>{try{await daemon(o.project,!!o.once)}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('worker-runtime').requiredOption('-p, --project <path>').requiredOption('-w, --worker <id>').option('--once','claim at most one task').option('--lease-ms <number>','worker lease duration','30000').option('--poll-ms <number>','idle polling interval','5000').action(async o=>{try{await workerRuntime(o.project,{workerId:o.worker,once:!!o.once,leaseMs:Number(o.leaseMs),pollMs:Number(o.pollMs)})}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('worker-runtime-status').requiredOption('-p, --project <path>').action(async o=>{try{console.log(JSON.stringify(await runtimeStatus(o.project),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('events')
  .requiredOption('-p, --project <path>')
  .option('--after <sequence>','start after event sequence','0')
  .option('--limit <number>','maximum events','50')
  .option('--type <type>','filter by event type')
  .action(async o=>{ console.log(JSON.stringify(await listEventStream(o.project, Number(o.after), Number(o.limit), o.type), null, 2)); });

program.command('event-publish')
  .requiredOption('-p, --project <path>')
  .requiredOption('--type <type>')
  .option('--payload <json>','JSON payload','{}')
  .option('--task <id>')
  .option('--run <id>')
  .option('--producer <id>','event producer','cli')
  .action(async o=>{ console.log(JSON.stringify(await publishEvent(o.project, {type:o.type, payload:JSON.parse(o.payload), taskId:o.task, runId:o.run, producer:o.producer}), null, 2)); });

program.command('event-consumer-status')
  .requiredOption('-p, --project <path>')
  .action(async o=>{ console.log(JSON.stringify(await eventStatus(o.project), null, 2)); });

program.command('event-consume')
  .requiredOption('-p, --project <path>')
  .requiredOption('--consumer <id>')
  .option('--limit <number>','maximum events','50')
  .option('--once','consume one batch and acknowledge it')
  .action(async o=>{ console.log(JSON.stringify(await consumeEventsOnce(o.project, o.consumer, Number(o.limit), Boolean(o.once)), null, 2)); });

program.command('control-plane')
  .requiredOption('-p, --project <path>')
  .option('--consumer <id>','durable control-plane consumer id','control-plane')
  .option('--limit <number>','maximum events per batch','50')
  .option('--poll-ms <number>','idle poll interval','1000')
  .option('--once','process one batch and exit')
  .action(async o=>{try{await controlLoop(o.project,{consumerId:o.consumer,limit:Number(o.limit),pollMs:Number(o.pollMs),once:!!o.once})}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('failure-patterns')
  .requiredOption('-p, --project <path>')
  .option('--limit <number>','maximum patterns','50')
  .action(async o=>{const db=await openDb(path.resolve(o.project));try{console.log(JSON.stringify(db.prepare('SELECT * FROM failure_fingerprints ORDER BY updated_at DESC LIMIT ?').all(Math.max(1,Math.min(Number(o.limit),200))),null,2));}finally{db.close();}});

program.command('failure-history')
  .requiredOption('-p, --project <path>')
  .option('-t, --task <id>')
  .option('--limit <number>','maximum records','50')
  .action(async o=>{const db=await openDb(path.resolve(o.project));try{console.log(JSON.stringify(failureHistory(db,o.task,Number(o.limit)),null,2));}finally{db.close();}});

program.command('memory-search')
  .requiredOption('-p, --project <path>')
  .requiredOption('--query <text>')
  .option('--limit <number>','maximum records','20')
  .action(async o=>{try{console.log(JSON.stringify(await searchMemory(o.project,o.query,Number(o.limit)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('memory-task')
  .requiredOption('-p, --project <path>')
  .requiredOption('--task <id>')
  .option('--limit <number>','maximum records','20')
  .action(async o=>{try{console.log(JSON.stringify(await taskMemory(o.project,o.task,Number(o.limit)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('memory-failure')
  .requiredOption('-p, --project <path>')
  .requiredOption('--fingerprint <id>')
  .option('--limit <number>','maximum records','20')
  .action(async o=>{try{console.log(JSON.stringify(await failureMemory(o.project,o.fingerprint,Number(o.limit)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('memory-add')
  .requiredOption('-p, --project <path>')
  .requiredOption('--kind <kind>')
  .requiredOption('--title <title>')
  .requiredOption('--content <content>')
  .option('--task <id>')
  .option('--run <id>')
  .option('--fingerprint <id>')
  .option('--source <source>','memory source','cli')
  .option('--confidence <number>','confidence','0.5')
  .action(async o=>{try{console.log(JSON.stringify(await remember(o.project,{kind:o.kind,title:o.title,content:o.content,taskId:o.task,runId:o.run,fingerprint:o.fingerprint,source:o.source,confidence:Number(o.confidence)}),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('memory-status')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{console.log(JSON.stringify(await memoryStats(o.project),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('code-index')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{console.log(JSON.stringify(await indexCodebase(path.resolve(o.project)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('code-graph')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{console.log(JSON.stringify(await codeGraphStats(path.resolve(o.project)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('impact <target>')
  .requiredOption('-p, --project <path>')
  .option('--depth <number>','reverse dependency depth','2')
  .action(async(target,o)=>{try{console.log(JSON.stringify(await codeImpact(path.resolve(o.project),target,Number(o.depth)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('code-context <task>')
  .requiredOption('-p, --project <path>')
  .option('--limit <number>','maximum graph matches','12')
  .action(async(task,o)=>{try{const root=path.resolve(o.project);const t=(await listTasks(root)).find(x=>x.id===task);if(!t)throw new Error(`Task not found: ${task}`);console.log(JSON.stringify(await codeContextForTask(root,t,Number(o.limit)),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('recovery-status')
  .requiredOption('-p, --project <path>')
  .option('--task <id>','filter by task')
  .action(async o=>{try{console.log(JSON.stringify(await recoveryStatus(o.project,o.task),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('workers').requiredOption('-p, --project <path>').action(async o=>{const c=await loadConfig(path.resolve(o.project));for(const w of c.workers)console.log(`${w.enabled===false?'OFF':'ON'}\t${w.id}\t${w.provider}\t${w.model}`)});
program.command('worker-test')
  .requiredOption('-p, --project <path>')
  .requiredOption('-w, --worker <id>')
  .option('--timeout-ms <number>','probe timeout','30000')
  .action(async o=>{try{const root=path.resolve(o.project);const c=await loadConfig(root);const w=c.workers.find(x=>x.id===o.worker);if(!w)throw new Error(`Worker not configured: ${o.worker}`);console.log(JSON.stringify(await checkWorker(w,root,Math.max(1000,Number(o.timeoutMs)||30000)),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('observability')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{console.log(JSON.stringify(await collectObservability(path.resolve(o.project)),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('observability-status')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{console.log(JSON.stringify(await observabilityStatus(path.resolve(o.project)),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('logs')
  .requiredOption('-p, --project <path>')
  .option('-n, --limit <number>','number of log records','100')
  .action(async o=>{try{console.log(JSON.stringify(await tailLogs(path.resolve(o.project),Number(o.limit)||100),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('security-check').requiredOption('-p, --project <path>').option('--task <id>').option('--worker <id>').action(async o=>{try{const root=path.resolve(o.project);const c=await loadConfig(root);const t=o.task?await (await import('./core/config.js')).loadTask(root,o.task):{id:'security-check',version:1,title:'security-check',type:'security',status:'ready',objective:'preflight',acceptance_criteria:[],risk:'low'} as any;const w=o.worker?c.workers.find(x=>x.id===o.worker):undefined; if(o.worker&&!w)throw new Error(`Worker not configured: ${o.worker}`); console.log(JSON.stringify(await securityPreflight(root,c,t,w),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('doctor').requiredOption('-p, --project <path>').action(async o=>{const ok=await doctor(o.project);if(!ok)process.exitCode=1});
program.command('production-readiness').requiredOption('-p, --project <path>').action(async o=>{try{const r=await productionReadiness(path.resolve(o.project));console.log(JSON.stringify(r,null,2));if(!r.ready)process.exitCode=1}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('db-backup').requiredOption('-p, --project <path>').requiredOption('--output <file>').action(async o=>{try{console.log(JSON.stringify(await databaseBackup(path.resolve(o.project),o.output),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('db-verify').requiredOption('--file <file>').action(async o=>{try{const r=await verifyDatabaseBackup(o.file);console.log(JSON.stringify(r,null,2));if(!r.valid)process.exitCode=1}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('db-restore').requiredOption('-p, --project <path>').requiredOption('--file <file>').action(async o=>{try{console.log(JSON.stringify(await restoreDatabase(path.resolve(o.project),o.file),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('sync').requiredOption('-p, --project <path>').action(async o=>{await syncProject(o.project);console.log('Project synchronized.');});
program.command('learn').requiredOption('-p, --project <path>').action(async o=>{try{const r=await learn(path.resolve(o.project));console.log(JSON.stringify(r,null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('learning').requiredOption('-p, --project <path>').action(async o=>{const db=await openDb(o.project);console.log(JSON.stringify(db.prepare('SELECT * FROM learning_insights ORDER BY confidence DESC, success_rate DESC').all(),null,2));db.close();});
program.command('verify <task>').requiredOption('-p, --project <path>').option('--run <runId>').action(async(task,o)=>{try{console.log(JSON.stringify(await verifyTask(path.resolve(o.project),task,o.run),null,2))}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('worker-scores').requiredOption('-p, --project <path>').action(async o=>{const db=await openDb(o.project);console.log(JSON.stringify(workerScoreSummary(db),null,2));db.close();});
program.command('route <task>').requiredOption('-p, --project <path>').requiredOption('--role <role>').action(async(task,o)=>{try{const root=path.resolve(o.project);const tasks=await listTasks(root);const t=tasks.find(x=>x.id===task);if(!t)throw new Error(`Task not found: ${task}`);const config=await loadConfig(root);console.log(JSON.stringify(await routingReport(root,t,config,o.role),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('routing-evidence').requiredOption('-p, --project <path>').option('-n, --limit <number>','number of decisions','50').action(async o=>{const db=await openDb(o.project);console.log(JSON.stringify(routingSummary(db,Math.max(1,Number(o.limit)||50)),null,2));db.close();});
program.command('evidence <task>').requiredOption('-p, --project <path>').action(async(task,o)=>{const db=await openDb(o.project);console.log(JSON.stringify(taskEvidence(db,task),null,2));db.close();});
program.command('db').requiredOption('-p, --project <path>').action(async o=>{const db=await openDb(o.project);console.log(JSON.stringify(dbSummary(db),null,2));db.close();});
program.command('dashboard').requiredOption('-p, --project <path>').option('--port <number>','port','4317').action(async o=>{await dashboard(o.project,Number(o.port));});
program.command('capacity-plan')
  .requiredOption('-p, --project <path>')
  .option('--limit <number>','maximum ready tasks','50')
  .action(async o=>{try{const root=path.resolve(o.project);const tasks=(await listTasks(root)).filter(t=>t.status==='ready').slice(0,Math.max(1,Math.min(200,Number(o.limit)||50)));console.log(JSON.stringify(await capacityPlan(root,tasks),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('capacity-recommendations')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{console.log(JSON.stringify(await capacityRecommendations(o.project),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('capacity-history')
  .requiredOption('-p, --project <path>')
  .option('--task <id>')
  .action(async o=>{try{console.log(JSON.stringify(await capacityHistory(o.project,o.task),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});


program.command('health')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{console.log(JSON.stringify(await healthReport(path.resolve(o.project)),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('operations-status')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{const root=path.resolve(o.project);const db=await openDb(root);try{ensureOperationsSchema(db);console.log(JSON.stringify(operationStatus(db),null,2));}finally{db.close();}}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});

program.command('reliability-test')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{const {runReliabilitySuite,persistReliabilityReport}=await import('./core/reliability.js');const root=path.resolve(o.project);const report=await runReliabilitySuite(root);await persistReliabilityReport(root,report);console.log(JSON.stringify(report,null,2));if(report.status==='fail')process.exitCode=1;}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('reliability-status')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{const {reliabilityStatus}=await import('./core/reliability.js');console.log(JSON.stringify(await reliabilityStatus(path.resolve(o.project)),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});
program.command('reliability-history')
  .requiredOption('-p, --project <path>')
  .action(async o=>{try{const {reliabilityHistory}=await import('./core/reliability.js');console.log(JSON.stringify(await reliabilityHistory(path.resolve(o.project)),null,2));}catch(e){console.error(`[Aegis] ${e instanceof Error?e.message:e}`);process.exitCode=1}});


program.parseAsync();
