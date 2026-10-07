import path from 'node:path';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const execFileAsync = promisify(execFile);
const REQUIRED_DOCS = ['PROJECT.md','PRODUCT.md','REQUIREMENTS.md','ARCHITECTURE.md','CONSTRAINTS.md','QUALITY.md','SECURITY.md','TESTING.md','ROADMAP.md','STATE.md','DECISIONS.md','CHANGELOG.md'];

export type Check = { name:string; ok:boolean; severity:'required'|'advisory'; detail:string };

async function exists(p:string){ try { await access(p); return true; } catch { return false; } }

async function git(root:string, args:string[]){
  try { const r=await execFileAsync('git',args,{cwd:root,maxBuffer:2_000_000}); return r.stdout.trim(); }
  catch { return ''; }
}

export async function productionReadiness(root:string){
  const checks:Check[]=[];
  const add=(name:string,ok:boolean,detail:string,severity:'required'|'advisory'='required')=>checks.push({name,ok,detail,severity});
  add('project-root', await exists(path.join(root,'.ai')) && await exists(path.join(root,'.aegis')), 'Required .ai and .aegis directories are present.');
  for(const doc of REQUIRED_DOCS) add(`doc:${doc}`,await exists(path.join(root,'.ai',doc)),`Canonical .ai/${doc} is present.`);
  add('config', true, '');
  try {
    const cfg=await loadConfig(root);
    add('config-validation',true,'Configuration parsed and safety bounds validated.');
    const secretLike=JSON.stringify(cfg).match(/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']+/i);
    add('config-secrets',!secretLike,'No obvious inline secret assignment found in serialized configuration.');
    add('isolated-workers',cfg.security?.require_isolated_worker===true,'Security policy requires isolated worker execution.');
    add('bounded-parallelism',Number(cfg.defaults.max_parallel_workers)<=32,'Parallel worker bound is <= 32.');
  } catch(e){ add('config-validation',false,e instanceof Error?e.message:String(e)); }
  const dbPath=path.join(root,'.aegis','aegis.db');
  if(await exists(dbPath)){
    try { const db=new DatabaseSync(dbPath); const integrity=(db.prepare('PRAGMA integrity_check').get() as any)?.integrity_check; const fk=(db.prepare('PRAGMA foreign_keys').get() as any)?.foreign_keys; add('db-integrity',integrity==='ok',`SQLite integrity_check: ${integrity}`); add('db-wal',String((db.prepare('PRAGMA journal_mode').get() as any)?.journal_mode).toLowerCase()==='wal','SQLite WAL mode is enabled.'); add('db-foreign-keys',Number(fk)===1,'SQLite foreign-key enforcement is enabled.','advisory'); db.close(); }
    catch(e){ add('db-open',false,e instanceof Error?e.message:String(e)); }
  } else add('db-present',false,'Control-plane database is missing.');
  const status=await git(root,['status','--porcelain']);
  add('git-clean',status==='',status===''?'Working tree is clean.':`Working tree has uncommitted changes (${status.split('\n').filter(Boolean).length}).`,'advisory');
  add('git-repository',Boolean(await git(root,['rev-parse','--show-toplevel'])),'Git repository is available.');
  const envExample=await exists(path.join(root,'.env.example')) || await exists(path.join(root,'.aegis','.env.example'));
  add('secret-boundary-doc',envExample,'An environment-variable example documents external secret injection.','advisory');
  add('runtime-isolation',false,'OS/container/VM isolation must be provided by the deployment environment; Aegis cannot prove it from the project alone.','advisory');
  const required=checks.filter(c=>c.severity==='required');
  return {version:'7.0.1',ready:required.every(c=>c.ok),checkedAt:new Date().toISOString(),checks,summary:{total:checks.length,passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,requiredFailed:required.filter(c=>!c.ok).length}};
}

export async function databaseBackup(root:string,destination:string){
  const dbPath=path.join(root,'.aegis','aegis.db');
  if(!await exists(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  const db=new DatabaseSync(dbPath);
  try { const dest=path.resolve(destination); const parent=path.dirname(dest); const {mkdir}=await import('node:fs/promises'); await mkdir(parent,{recursive:true}); const escaped=dest.replace(/'/g,"''"); db.exec(`VACUUM INTO '${escaped}'`); return {source:dbPath,destination:dest,createdAt:new Date().toISOString()}; }
  finally { db.close(); }
}

export async function verifyDatabaseBackup(file:string){
  const db=new DatabaseSync(path.resolve(file));
  try { const integrity=(db.prepare('PRAGMA integrity_check').get() as any)?.integrity_check; const tables=Number((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get() as any)?.n||0); return {file:path.resolve(file),integrity,tableCount:tables,valid:integrity==='ok' && tables>0}; }
  finally { db.close(); }
}

export async function restoreDatabase(root:string,backup:string){
  const source=path.resolve(backup); if(!await exists(source)) throw new Error(`Backup not found: ${source}`);
  const target=path.join(root,'.aegis','aegis.db');
  const verification=await verifyDatabaseBackup(source); if(!verification.valid) throw new Error(`Backup failed integrity validation: ${JSON.stringify(verification)}`);
  const {copyFile,mkdir}=await import('node:fs/promises'); await mkdir(path.dirname(target),{recursive:true});
  const preRestore=`${target}.pre-restore-${Date.now()}.bak`;
  if(await exists(target)) { await databaseBackup(root,preRestore); }
  await copyFile(source,target);
  const check=await verifyDatabaseBackup(target);
  if(!check.valid) throw new Error('Restored database failed integrity validation.');
  return {backup:source,target,preRestoreBackup:await exists(preRestore)?preRestore:undefined,restoredAt:new Date().toISOString()};
}
