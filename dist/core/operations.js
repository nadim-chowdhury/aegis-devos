import os from 'node:os';
import path from 'node:path';
import { readFile, rename, unlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { ensureDir } from './fs.js';
export const CONTROL_SCHEMA_VERSION = 2;
function now() { return new Date().toISOString(); }
export async function ensureOperationsSchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operation_events_operation ON operation_events(operation_id, id);
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      status TEXT NOT NULL,
      response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(scope, key)
    );
    CREATE TABLE IF NOT EXISTS retry_state (
      operation_id TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_state (
      service TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      pid INTEGER,
      host TEXT,
      started_at TEXT,
      heartbeat_at TEXT,
      updated_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get();
    const current = row?.version ?? 1;
    if (current < CONTROL_SCHEMA_VERSION) {
        db.exec('BEGIN IMMEDIATE');
        try {
            db.prepare('UPDATE schema_version SET version=?').run(CONTROL_SCHEMA_VERSION);
            db.prepare('INSERT OR REPLACE INTO schema_migrations(version,applied_at) VALUES(?,?)').run(CONTROL_SCHEMA_VERSION, now());
            db.exec('COMMIT');
        }
        catch (error) {
            try {
                db.exec('ROLLBACK');
            }
            catch { }
            throw error;
        }
    }
    else {
        db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)').run(current, now());
    }
}
export function beginIdempotentOperation(db, scope, key) {
    const timestamp = now();
    const inserted = db.prepare('INSERT OR IGNORE INTO idempotency_keys(scope,key,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(scope, key, 'running', timestamp, timestamp);
    const existing = db.prepare('SELECT status,response_json FROM idempotency_keys WHERE scope=? AND key=?').get(scope, key);
    return {
        existing: Number(inserted.changes) !== 1,
        status: existing.status,
        response: existing.response_json ? JSON.parse(existing.response_json) : undefined
    };
}
export function scheduleRetry(db, operationId, attempt, error, baseDelayMs = 1000, maxDelayMs = 60_000) {
    const boundedAttempt = Math.max(1, Math.min(20, Math.floor(attempt)));
    const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (boundedAttempt - 1)));
    const next = new Date(Date.now() + Math.max(0, delay)).toISOString();
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`INSERT INTO retry_state(operation_id,attempts,next_attempt_at,last_error,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(operation_id) DO UPDATE SET attempts=excluded.attempts,next_attempt_at=excluded.next_attempt_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
        .run(operationId, boundedAttempt, next, message, now());
    return { operationId, attempt: boundedAttempt, delayMs: delay, nextAttemptAt: next };
}
export function clearRetry(db, operationId) {
    db.prepare('DELETE FROM retry_state WHERE operation_id=?').run(operationId);
}
export function completeIdempotentOperation(db, scope, key, response) {
    db.prepare('UPDATE idempotency_keys SET status=?,response_json=?,updated_at=? WHERE scope=? AND key=?').run('completed', JSON.stringify(response), now(), scope, key);
}
export function failIdempotentOperation(db, scope, key, error) {
    db.prepare('UPDATE idempotency_keys SET status=?,response_json=?,updated_at=? WHERE scope=? AND key=?').run('failed', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), now(), scope, key);
}
export function recordOperation(db, operationId, type, status, payload = {}) {
    db.prepare('INSERT INTO operation_events(operation_id,type,status,payload_json,created_at) VALUES(?,?,?,?,?)').run(operationId, type, status, JSON.stringify(payload), now());
}
export function setServiceState(db, service, status, metadata = {}) {
    const timestamp = now();
    db.prepare(`INSERT INTO service_state(service,status,pid,host,started_at,heartbeat_at,updated_at,metadata_json)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(service) DO UPDATE SET status=excluded.status,pid=excluded.pid,host=excluded.host,heartbeat_at=excluded.heartbeat_at,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`)
        .run(service, status, process.pid, os.hostname(), timestamp, timestamp, timestamp, JSON.stringify(metadata));
}
export function heartbeatService(db, service) {
    db.prepare('UPDATE service_state SET heartbeat_at=?,updated_at=? WHERE service=?').run(now(), now(), service);
}
export async function atomicProjectLock(root, operationId, staleAfterMs = 30 * 60_000) {
    const dir = path.join(root, '.ai');
    await ensureDir(dir);
    const file = path.join(dir, '.aegis.lock');
    const payload = JSON.stringify({ operationId, pid: process.pid, host: os.hostname(), createdAt: now() }, null, 2);
    try {
        const handle = await import('node:fs/promises').then(fs => fs.open(file, 'wx'));
        try {
            await handle.writeFile(payload, 'utf8');
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        if (error?.code !== 'EEXIST')
            throw error;
        let owner = undefined;
        try {
            owner = JSON.parse(await readFile(file, 'utf8'));
        }
        catch { }
        const created = owner?.createdAt ? Date.parse(owner.createdAt) : NaN;
        const stale = Number.isFinite(created) && Date.now() - created > staleAfterMs;
        if (!stale)
            throw new Error(`Project is locked by another Aegis operation: ${JSON.stringify(owner ?? {})}`);
        const staleFile = `${file}.stale-${Date.now()}-${process.pid}`;
        await rename(file, staleFile);
        const handle = await import('node:fs/promises').then(fs => fs.open(file, 'wx'));
        try {
            await handle.writeFile(payload, 'utf8');
        }
        finally {
            await handle.close();
        }
    }
    let released = false;
    const release = async () => {
        if (released)
            return;
        released = true;
        try {
            const current = JSON.parse(await readFile(file, 'utf8'));
            if (current.operationId === operationId && current.pid === process.pid)
                await unlink(file);
        }
        catch { }
    };
    process.once('exit', () => { void release(); });
    return release;
}
export async function healthReport(root, requiredDiskBytes = 50 * 1024 * 1024) {
    const dbPath = path.join(root, '.aegis', 'aegis.db');
    const result = {
        ready: false, projectRoot: root,
        database: { ok: false, path: dbPath }, config: { ok: false }, lock: { active: false },
        disk: { ok: false, freeBytes: 0, requiredBytes: requiredDiskBytes }
    };
    try {
        const db = new DatabaseSync(dbPath);
        const mode = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
        const version = db.prepare('SELECT version FROM schema_version LIMIT 1').get()?.version;
        result.database = { ok: true, path: dbPath, journalMode: String(mode), schemaVersion: Number(version) };
        db.close();
    }
    catch (e) {
        result.database.error = e instanceof Error ? e.message : String(e);
    }
    try {
        const { loadConfig } = await import('./config.js');
        await loadConfig(root);
        result.config.ok = true;
    }
    catch (e) {
        result.config.error = e instanceof Error ? e.message : String(e);
    }
    try {
        const stat = await import('node:fs/promises').then(fs => fs.stat(path.join(root, '.ai', '.aegis.lock')));
        const age = Date.now() - stat.mtimeMs;
        result.lock = { active: true, stale: age > 30 * 60_000 };
        try {
            result.lock.owner = JSON.parse(await readFile(path.join(root, '.ai', '.aegis.lock'), 'utf8'));
        }
        catch { }
    }
    catch {
        result.lock = { active: false };
    }
    try {
        const statfs = await import('node:fs/promises').then(fs => fs.statfs(root));
        result.disk.freeBytes = statfs.bavail * statfs.bsize;
        result.disk.ok = result.disk.freeBytes >= requiredDiskBytes;
    }
    catch {
        result.disk.ok = true;
    }
    result.ready = result.database.ok && result.config.ok && !result.lock.active && result.disk.ok;
    return result;
}
export function operationStatus(db) {
    return {
        schemaVersion: Number(db.prepare('SELECT version FROM schema_version LIMIT 1').get()?.version ?? 0),
        services: db.prepare('SELECT * FROM service_state ORDER BY service').all(),
        retries: db.prepare('SELECT * FROM retry_state ORDER BY updated_at DESC LIMIT 100').all(),
        recentOperations: db.prepare('SELECT * FROM operation_events ORDER BY id DESC LIMIT 100').all(),
        idempotency: db.prepare('SELECT status,COUNT(*) AS count FROM idempotency_keys GROUP BY status').all(),
    };
}
