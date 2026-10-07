import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { openDb } from './db.js';
const EXT = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', dart: 'dart' };
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', 'out']);
function language(file) { return EXT[path.extname(file).slice(1).toLowerCase()] || 'unknown'; }
function lineAt(text, index) { return text.slice(0, index).split('\n').length; }
function symbolRows(filePath, text) {
    const rows = [];
    const patterns = [
        { re: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
        { re: /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
        { re: /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g, kind: 'interface' },
        { re: /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g, kind: 'type' },
        { re: /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, kind: 'variable' },
        { re: /\b(?:export\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g, kind: 'symbol' }
    ];
    const seen = new Set();
    for (const p of patterns) {
        for (const m of text.matchAll(p.re)) {
            const name = m[1];
            const id = `${filePath}::${name}`;
            if (seen.has(id))
                continue;
            seen.add(id);
            const before = text.slice(0, m.index ?? 0);
            const line = before.split('\n').length;
            const start = Math.max(0, (m.index ?? 0) - 16);
            const exported = /\bexport\b/.test(text.slice(start, (m.index ?? 0) + 16));
            rows.push({ id, filePath, name, kind: p.kind, line, exported });
        }
    }
    return rows;
}
function importSpecs(filePath, text) { const out = []; const patterns = [/\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g, /\bexport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g]; for (const p of patterns)
    for (const m of text.matchAll(p))
        out.push(m[1]); return [...new Set(out)]; }
async function filesUnder(root, dir, out) { let entries; try {
    entries = await readdir(dir, { withFileTypes: true });
}
catch {
    return;
} for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.aegis'))
        continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory())
        await filesUnder(root, full, out);
    else if (EXT[path.extname(e.name).slice(1).toLowerCase()])
        out.push(path.relative(root, full).replaceAll(path.sep, '/'));
} }
function resolveSpecifier(from, spec, known) {
    if (!spec.startsWith('.'))
        return undefined;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    const candidates = [base, ...Object.keys(EXT).map(e => `${base}.${e}`), ...Object.keys(EXT).map(e => path.posix.join(base, `index.${e}`))];
    return candidates.find(x => known.has(x));
}
export async function indexCodebase(project) {
    const root = path.resolve(project), db = await openDb(root);
    try {
        const rel = [];
        await filesUnder(root, root, rel);
        const known = new Set(rel);
        db.exec('BEGIN');
        db.exec('DELETE FROM code_edges; DELETE FROM code_symbols; DELETE FROM code_files;');
        const now = new Date().toISOString();
        const fileStmt = db.prepare('INSERT INTO code_files(path,language,hash,size,indexed_at) VALUES(?,?,?,?,?)');
        const symStmt = db.prepare('INSERT INTO code_symbols(id,file_path,name,kind,line,exported) VALUES(?,?,?,?,?,?)');
        const edgeStmt = db.prepare('INSERT INTO code_edges(from_file,to_file,kind,specifier) VALUES(?,?,?,?)');
        let symbols = 0, edges = 0;
        for (const relPath of rel) {
            let text;
            try {
                text = await readFile(path.join(root, relPath), 'utf8');
            }
            catch {
                continue;
            }
            const hash = createHash('sha256').update(text).digest('hex');
            fileStmt.run(relPath, language(relPath), hash, Buffer.byteLength(text), now);
            for (const s of symbolRows(relPath, text)) {
                symStmt.run(s.id, s.filePath, s.name, s.kind, s.line, s.exported ? 1 : 0);
                symbols++;
            }
            for (const spec of importSpecs(relPath, text)) {
                const target = resolveSpecifier(relPath, spec, known);
                if (target) {
                    edgeStmt.run(relPath, target, 'import', spec);
                    edges++;
                }
            }
        }
        db.exec('COMMIT');
        return { files: rel.length, symbols, edges, indexedAt: now };
    }
    catch (e) {
        try {
            db.exec('ROLLBACK');
        }
        catch { }
        ;
        throw e;
    }
    finally {
        db.close();
    }
}
export async function codeGraphStats(project) { const db = await openDb(path.resolve(project)); try {
    return { files: db.prepare('SELECT COUNT(*) count FROM code_files').get().count, symbols: db.prepare('SELECT COUNT(*) count FROM code_symbols').get().count, edges: db.prepare('SELECT COUNT(*) count FROM code_edges').get().count, topFiles: db.prepare('SELECT f.path,COUNT(e.to_file) as imports FROM code_files f LEFT JOIN code_edges e ON e.from_file=f.path GROUP BY f.path ORDER BY imports DESC LIMIT 20').all() };
}
finally {
    db.close();
} }
export async function codeImpact(project, target, depth = 2) {
    const db = await openDb(path.resolve(project));
    try {
        const max = Math.max(1, Math.min(depth, 4));
        const start = target.replaceAll('\\', '/');
        const exact = db.prepare('SELECT path FROM code_files WHERE path=?').get(start)?.path;
        const symbol = db.prepare('SELECT file_path FROM code_symbols WHERE id=? OR name=? LIMIT 1').get(start, start)?.file_path;
        const root = exact || symbol;
        if (!root)
            return { target, found: false, affected: [] };
        const seen = new Set([root]);
        let frontier = [root];
        const affected = [];
        for (let d = 1; d <= max; d++) {
            const next = [];
            for (const f of frontier) {
                const rows = db.prepare('SELECT from_file,kind,specifier FROM code_edges WHERE to_file=?').all(f);
                for (const r of rows) {
                    if (!seen.has(r.from_file)) {
                        seen.add(r.from_file);
                        next.push(r.from_file);
                        affected.push({ path: r.from_file, depth: d, relation: r.kind, specifier: r.specifier });
                    }
                }
            }
            frontier = next;
            if (!frontier.length)
                break;
        }
        return { target: root, found: true, depth: max, affected };
    }
    finally {
        db.close();
    }
}
export async function codeContextForTask(project, task, limit = 12) { const db = await openDb(path.resolve(project)); try {
    const text = [task.title, task.objective, ...task.acceptance_criteria].join(' ').toLowerCase();
    const words = [...new Set((text.match(/[a-zA-Z][a-zA-Z0-9_$-]{2,}/g) || []))].slice(0, 20);
    const hits = [];
    for (const w of words) {
        const rows = db.prepare('SELECT file_path,name,kind,line,exported FROM code_symbols WHERE lower(name) LIKE ? ORDER BY exported DESC,line LIMIT 8').all(`%${w}%`);
        for (const r of rows)
            hits.push({ ...r, score: r.name.toLowerCase() === w ? 3 : 1 });
        const files = db.prepare('SELECT path FROM code_files WHERE lower(path) LIKE ? LIMIT 5').all(`%${w}%`);
        for (const f of files)
            hits.push({ file_path: f.path, name: '', kind: 'file', line: 1, exported: false, score: 1 });
    }
    const seen = new Set();
    return hits.sort((a, b) => b.score - a.score || a.file_path.localeCompare(b.file_path)).filter(x => { const k = `${x.file_path}::${x.name}`; if (seen.has(k))
        return false; seen.add(k); return true; }).slice(0, limit);
}
finally {
    db.close();
} }
