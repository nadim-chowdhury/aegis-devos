import path from 'node:path';
import os from 'node:os';
import { open, readFile, unlink } from 'node:fs/promises';
import { ensureDir } from './fs.js';
export async function acquireLock(root, runId, staleAfterMs = 30 * 60_000) {
    const file = path.join(root, '.ai/.aegis.lock');
    await ensureDir(path.dirname(file));
    const payload = JSON.stringify({ runId, pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString() }, null, 2);
    try {
        const h = await open(file, 'wx');
        try {
            await h.writeFile(payload, 'utf8');
        }
        finally {
            await h.close();
        }
    }
    catch (e) {
        if (e?.code !== 'EEXIST')
            throw e;
        let owner;
        try {
            owner = JSON.parse(await readFile(file, 'utf8'));
        }
        catch { }
        const created = owner?.createdAt ? Date.parse(owner.createdAt) : NaN;
        if (!Number.isFinite(created) || Date.now() - created <= staleAfterMs)
            throw new Error(`Project is locked by another Aegis run. ${JSON.stringify(owner ?? {})}`);
        throw new Error(`Project lock appears stale and requires explicit operator cleanup: ${JSON.stringify(owner ?? {})}`);
    }
    let released = false;
    const release = async () => {
        if (released)
            return;
        released = true;
        try {
            const owner = JSON.parse(await readFile(file, 'utf8'));
            if (owner.runId === runId && owner.pid === process.pid)
                await unlink(file);
        }
        catch { }
    };
    process.once('exit', () => { void release(); });
    return release;
}
