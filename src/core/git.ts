import {execFile} from 'node:child_process'; import {promisify} from 'node:util'; import path from 'node:path';
const exec=promisify(execFile);
export async function git(project:string,args:string[]){const r=await exec('git',args,{cwd:project,maxBuffer:2_000_000});return r.stdout.trim()}
export async function ensureGitSafe(project:string,requireClean=true){if(!requireClean)return;const status=await git(project,['status','--porcelain']);if(status)throw new Error('Git working tree is not clean. Commit/stash your existing work before Aegis runs.')}
export async function branch(project:string,name:string){try{await git(project,['switch','-c',name])}catch{await git(project,['switch',name])}}
export async function commit(project:string,message:string){await git(project,['add','-A']);await git(project,['commit','-m',message])}
export async function currentBranch(project:string){return git(project,['branch','--show-current'])}
export async function worktreeAdd(project:string,worktreePath:string,branchName:string){
  await exec('git',['worktree','add','-b',branchName,worktreePath,'HEAD'],{cwd:project,maxBuffer:2_000_000});
  return path.resolve(worktreePath);
}
export async function worktreeRemove(project:string,worktreePath:string,force=false){await exec('git',['worktree','remove',...(force?['--force']:[]),worktreePath],{cwd:project,maxBuffer:2_000_000});}
export async function mergeBranch(project:string,branchName:string,message?:string){await git(project,['merge','--no-ff',branchName,'-m',message||`aegis: merge ${branchName}`]);}
export async function deleteBranch(project:string,branchName:string){await git(project,['branch','-D',branchName]);}
