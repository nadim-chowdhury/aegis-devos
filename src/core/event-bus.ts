import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb } from './db.js';

export interface DomainEventInput { type:string; payload?:unknown; taskId?:string; runId?:string; producer?:string; }
export interface EventRecord { sequence:number; eventId:string; type:string; topic:string; taskId?:string; runId?:string; producer:string; payload:unknown; createdAt:string; }

function ensureEventSchema(db:any) {
 db.exec(`CREATE TABLE IF NOT EXISTS event_stream(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,topic TEXT NOT NULL,type TEXT NOT NULL,task_id TEXT,run_id TEXT,producer TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_event_stream_type_sequence ON event_stream(type,sequence);
 CREATE INDEX IF NOT EXISTS idx_event_stream_task_sequence ON event_stream(task_id,sequence);
 CREATE INDEX IF NOT EXISTS idx_event_stream_run_sequence ON event_stream(run_id,sequence);
 CREATE TABLE IF NOT EXISTS event_consumers(consumer_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS event_deliveries(consumer_id TEXT NOT NULL,sequence INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(consumer_id,sequence));`);
}
function topicFor(type:string){ return type.split(':',1)[0] || 'system'; }
function toEvent(row:any):EventRecord{return {sequence:Number(row.sequence),eventId:row.event_id,type:row.type,topic:row.topic,taskId:row.task_id??undefined,runId:row.run_id??undefined,producer:row.producer,payload:JSON.parse(row.payload_json),createdAt:row.created_at};}
export function appendEvent(db:any,input:DomainEventInput):EventRecord{
 ensureEventSchema(db); const createdAt=new Date().toISOString(); const eventId=randomUUID(); const payload=JSON.stringify(input.payload??{});
 const result=db.prepare(`INSERT INTO event_stream(event_id,topic,type,task_id,run_id,producer,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(eventId,topicFor(input.type),input.type,input.taskId??null,input.runId??null,input.producer??'aegis',payload,createdAt);
 return toEvent(db.prepare('SELECT * FROM event_stream WHERE sequence=?').get(Number(result.lastInsertRowid)));
}
export async function publishEvent(project:string,input:DomainEventInput){const db=await openDb(path.resolve(project));try{db.exec('BEGIN IMMEDIATE');try{const e=appendEvent(db,input);db.exec('COMMIT');return e;}catch(e){db.exec('ROLLBACK');throw e;}}finally{db.close();}}
export async function listEventStream(project:string,after=0,limit=50,type?:string){const db=await openDb(path.resolve(project));try{ensureEventSchema(db);const n=Math.max(1,Math.min(limit,500));const rows=type?db.prepare('SELECT * FROM event_stream WHERE sequence>? AND type=? ORDER BY sequence ASC LIMIT ?').all(after,type,n):db.prepare('SELECT * FROM event_stream WHERE sequence>? ORDER BY sequence ASC LIMIT ?').all(after,n);return rows.map(toEvent);}finally{db.close();}}
export async function consumeEventsOnce(project:string,consumerId:string,limit=50,acknowledge=true){const db=await openDb(path.resolve(project));try{ensureEventSchema(db);const now=new Date().toISOString();db.prepare(`INSERT INTO event_consumers(consumer_id,last_sequence,updated_at) VALUES(?,?,?) ON CONFLICT(consumer_id) DO NOTHING`).run(consumerId,0,now);const state:any=db.prepare('SELECT * FROM event_consumers WHERE consumer_id=?').get(consumerId);const n=Math.max(1,Math.min(limit,500));const events=db.prepare('SELECT * FROM event_stream WHERE sequence>? ORDER BY sequence ASC LIMIT ?').all(Number(state.last_sequence),n).map(toEvent);if(acknowledge&&events.length){const last=events.at(-1)!.sequence;db.prepare('UPDATE event_consumers SET last_sequence=?,updated_at=? WHERE consumer_id=?').run(last,now,consumerId);const stmt=db.prepare(`INSERT INTO event_deliveries(consumer_id,sequence,status,attempts,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(consumer_id,sequence) DO UPDATE SET status=excluded.status,attempts=event_deliveries.attempts+1,updated_at=excluded.updated_at`);for(const e of events)stmt.run(consumerId,e.sequence,'acknowledged',1,now);}return {consumerId,acknowledged:acknowledge,lastSequence:acknowledge&&events.length?events.at(-1)!.sequence:Number(state.last_sequence),events};}finally{db.close();}}
export async function eventStatus(project:string){const db=await openDb(path.resolve(project));try{ensureEventSchema(db);const total:any=db.prepare('SELECT COUNT(*) AS count,COALESCE(MAX(sequence),0) AS last_sequence FROM event_stream').get();const consumers:any[]=db.prepare('SELECT consumer_id,last_sequence,updated_at FROM event_consumers ORDER BY consumer_id').all();return {events:Number(total.count),lastSequence:Number(total.last_sequence),consumers:consumers.map(c=>({...c,pending:Math.max(0,Number(total.last_sequence)-Number(c.last_sequence))}))};}finally{db.close();}}
