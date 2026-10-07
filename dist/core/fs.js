import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
export const exists = async (p) => { try {
    await access(p);
    return true;
}
catch {
    return false;
} };
export const ensureDir = (p) => mkdir(p, { recursive: true });
export const readText = (p) => readFile(p, 'utf8');
export const writeText = async (p, s) => { await ensureDir(path.dirname(p)); await writeFile(p, s, 'utf8'); };
export async function remove(file) { const { rm } = await import('node:fs/promises'); await rm(file, { force: true }); }
