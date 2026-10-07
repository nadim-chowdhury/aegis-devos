#!/usr/bin/env node
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const checks = [];
const ok = (name, detail) => checks.push({name, ok:true, detail});
const fail = (name, detail) => { checks.push({name, ok:false, detail}); failures.push({name, detail}); };
const exists = async p => { try { await access(p); return true; } catch { return false; } };

const pkg = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
(pkg.version === '7.0.1' ? ok : fail)('package-version', `Expected 7.0.1; found ${pkg.version}.`);
const cli = await readFile(path.join(root,'src/cli.ts'),'utf8');
(cli.includes(".version('7.0.1')") ? ok : fail)('cli-version','CLI reports 7.0.1.');

for (const f of [
  'src/cli.ts','src/types.ts','src/core/factory.ts','src/core/release.ts',
  'src/core/security.ts','src/core/reliability.ts','src/core/observability.ts',
  'src/workers/adapters.ts','src/workers/antigravity.ts',
  'docs/PRODUCTION_RUNBOOK.md','docs/RELEASE_READINESS.md','docs/README.md'
]) (await exists(path.join(root,f)) ? ok : fail)(`file:${f}`, 'Required release artifact is present.');

const readiness = await readFile(path.join(root,'docs/RELEASE_READINESS.md'),'utf8');
(readiness.includes('V7.0') ? ok : fail)('readiness-doc','V7.0 readiness document is present.');
const changelog = await readFile(path.join(root,'CHANGELOG.md'),'utf8');
(changelog.includes('## 7.0.0') ? ok : fail)('changelog','7.0.0 changelog entry is present.');

for (const f of ['.env','.env.local','.env.production','.env.development']) {
  (await exists(path.join(root,f)) ? fail : ok)(`secret-file:${f}`, `Release root does not contain ${f}.`);
}
const files = [];
async function walk(dir) { for (const e of await readdir(dir,{withFileTypes:true})) { if (['node_modules','.git','dist'].includes(e.name)) continue; const p=path.join(dir,e.name); if(e.isDirectory()) await walk(p); else files.push(p); } }
await walk(root);
for (const f of files) {
  const rel=path.relative(root,f);
  if (/(^|[\\/])(?:\.env(?:\.|$)|.*\.db$|.*\.sqlite$|node_modules|dist[\\/])/.test(rel)) fail('release-secret-artifact',`Disallowed artifact: ${rel}`);
}
ok('archive-input-scan', `Scanned ${files.length} release source files for local secret/database artifacts.`);

const source = files.filter(f=>/\.(ts|mjs)$/.test(f) && path.relative(root,f) !== 'scripts/v7-acceptance.mjs');
let skipPerm = false;
for (const f of source) {
  const s = await readFile(f,'utf8');
  const forbidden = ['--dangerously-', 'skip-permissions'].join(''); if (s.includes(forbidden)) { fail('unsafe-permission-flag',`Forbidden permission-bypass flag found in ${path.relative(root,f)}.`); skipPerm=true; }
}
if (!skipPerm) ok('unsafe-permission-flag','No --dangerously-skip-permissions usage found.');

const requiredCommands = ['production-readiness','reliability-test','worker-test','security-check','factory','health','observability'];
for (const cmd of requiredCommands) (cli.includes(`command('${cmd}'`) ? ok : fail)(`cli:${cmd}`, `CLI command ${cmd} is registered.`);

console.log(JSON.stringify({version:'7.0.1', status: failures.length ? 'FAIL' : 'PASS', checkedAt:new Date().toISOString(), summary:{total:checks.length,passed:checks.filter(x=>x.ok).length,failed:failures.length},checks},null,2));
if (failures.length) process.exitCode=1;
