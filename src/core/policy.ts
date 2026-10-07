import path from 'node:path';
import {git} from './git.js';
import type {Config,Task} from '../types.js';

export async function enforcePolicy(root:string,task:Task,config:Config){
  const diff=(await git(root,['diff','--name-only','HEAD'])).split('\n').filter(Boolean);
  const status=(await git(root,['status','--porcelain'])).split('\n').filter(Boolean).map(x=>x.slice(3)).filter(Boolean);
  const changed=[...new Set([...diff,...status])];
  const max=config.policy?.max_changed_files;
  if(max && changed.length>max)throw new Error(`Policy violation: ${changed.length} changed files exceeds max ${max}.`);
  const protectedPaths=config.policy?.protected_paths||[];
  const forbidden=changed.filter(f=>protectedPaths.some(p=>f===p||f.startsWith(p.endsWith('/')?p:p+'/')));
  if(forbidden.length)throw new Error(`Protected paths changed: ${forbidden.join(', ')}`);
  const allowed=task.scope?.allowed||[];
  if(allowed.length){const outside=changed.filter(f=>!allowed.some(p=>f===p||f.startsWith(p.endsWith('/')?p:p+'/')));if(outside.length)throw new Error(`Task scope violation. Files outside allowed scope: ${outside.join(', ')}`)}
  const taskForbidden=task.scope?.forbidden||[]; const bad=changed.filter(f=>taskForbidden.some(p=>f===p||f.startsWith(p.endsWith('/')?p:p+'/')));if(bad.length)throw new Error(`Task forbidden paths changed: ${bad.join(', ')}`);
  const forbiddenCommands=config.policy?.forbidden_commands||[];
  if(forbiddenCommands.length){const log=await git(root,['diff','--cached','--']).catch(()=> '');for(const cmd of forbiddenCommands)if(log.includes(cmd))throw new Error(`Potential forbidden command/content detected: ${cmd}`)}
  void path.resolve(root);
}
