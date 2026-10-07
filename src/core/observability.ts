import path from 'node:path';
import { appendFile, mkdir, readFile, rename } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from './db.js';
import { healthReport } from './operations.js';

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const RETENTION_DAYS = 14;

function iso(){ return new Date().toISOString(); }
function logPath(root:string){ return path.join(root,'.aegis','aegis.ndjson'); }

export async function ensureObservabilitySchema(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS metric_samples(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value REAL NOT NULL,
    labels_json TEXT NOT NULL DEFAULT '{}',
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_metric_samples_name_time ON metric_samples(name,recorded_at);
  CREATE TABLE IF NOT EXISTS health_checks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    checked_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_health_checks_time ON health_checks(checked_at);
  CREATE TABLE IF NOT EXISTS operational_snapshots(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
}

async function rotateIfNeeded(file:string){
  try{
    const stat = await import('node:fs/promises').then(fs=>fs.stat(file));
    if(stat.size < MAX_LOG_BYTES) return;
    await rename(file, `${file}.${Date.now()}.1`);
  }catch{}
}

export async function writeLog(root:string, level:'debug'|'info'|'warn'|'error', message:string, fields:Record<string,unknown>={}){
  const file=logPath(root);
  await mkdir(path.dirname(file),{recursive:true});
  await rotateIfNeeded(file);
  const safeFields=JSON.parse(JSON.stringify(fields,(key,value)=>/token|secret|password|api[_-]?key|authorization|cookie/i.test(key)?'[REDACTED]':value));
  await appendFile(file,JSON.stringify({timestamp:iso(),level,message,...safeFields})+'\n','utf8');
}

export async function recordMetric(root:string,name:string,value:number,labels:Record<string,string|number|boolean>={}){
  if(!Number.isFinite(value)) throw new Error(`Metric value must be finite: ${name}`);
  const db=await openDb(root); try{ ensureObservabilitySchema(db); db.prepare('INSERT INTO metric_samples(name,value,labels_json,recorded_at) VALUES(?,?,?,?)').run(name,value,JSON.stringify(labels),iso()); } finally{db.close();}
}

export async function collectObservability(root:string){
  const health=await healthReport(root);
  const db=await openDb(root); try{
    ensureObservabilitySchema(db);
    const count=(sql:string)=>Number((db.prepare(sql).get() as any)?.n??0);
    const metrics={
      tasks_total:count('SELECT COUNT(*) n FROM tasks'),
      tasks_ready:count("SELECT COUNT(*) n FROM tasks WHERE status='ready'"),
      tasks_done:count("SELECT COUNT(*) n FROM tasks WHERE status='done'"),
      tasks_failed:count("SELECT COUNT(*) n FROM tasks WHERE status='failed'"),
      runs_running:count("SELECT COUNT(*) n FROM runs WHERE status='running'"),
      runs_stale:count("SELECT COUNT(*) n FROM runs WHERE status='stale'"),
      pending_approvals:count("SELECT COUNT(*) n FROM approvals WHERE status='pending'"),
      events_total:count('SELECT COUNT(*) n FROM events'),
      event_stream_total:count('SELECT COUNT(*) n FROM event_stream'),
      evidence_total:count('SELECT COUNT(*) n FROM evidence'),
      workers_running:count("SELECT COUNT(*) n FROM worker_leases WHERE status='running'"),
      recovery_pending:count("SELECT COUNT(*) n FROM recovery_requests WHERE status IN ('scheduled','running')")
    };
    for(const [name,value] of Object.entries(metrics)) db.prepare('INSERT INTO metric_samples(name,value,labels_json,recorded_at) VALUES(?,?,?,?)').run(name,value,'{}',iso());
    const snapshot={generatedAt:iso(),health,metrics};
    db.prepare('INSERT INTO operational_snapshots(payload_json,created_at) VALUES(?,?)').run(JSON.stringify(snapshot),snapshot.generatedAt);
    db.prepare('DELETE FROM metric_samples WHERE recorded_at < ?').run(new Date(Date.now()-RETENTION_DAYS*86400000).toISOString());
    db.prepare('DELETE FROM health_checks WHERE checked_at < ?').run(new Date(Date.now()-RETENTION_DAYS*86400000).toISOString());
    db.prepare('DELETE FROM operational_snapshots WHERE created_at < ?').run(new Date(Date.now()-RETENTION_DAYS*86400000).toISOString());
    return snapshot;
  } finally{db.close();}
}

export async function observabilityStatus(root:string){
  const db=await openDb(root); try{
    ensureObservabilitySchema(db);
    const latest=db.prepare('SELECT payload_json,created_at FROM operational_snapshots ORDER BY id DESC LIMIT 1').get() as any;
    const samples=db.prepare(`SELECT name,value,labels_json,recorded_at FROM metric_samples ORDER BY id DESC LIMIT 100`).all();
    return {latest:latest?JSON.parse(latest.payload_json):undefined,metrics:samples};
  }finally{db.close();}
}

export async function tailLogs(root:string,limit=100){
  try{const raw=await readFile(logPath(root),'utf8');return raw.trim().split('\n').slice(-Math.max(1,Math.min(limit,1000))).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return {raw:line}}});}
  catch{return [];}
}
