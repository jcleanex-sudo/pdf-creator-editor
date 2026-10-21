import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, access, readdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Publishes only the tested dist/ tree. It does not switch checkouts, delete
// source files, change repository visibility, or enable paid services.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const dist=path.join(root,'dist')
const git=(args,options={})=>{
  try { return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],...options}).trim() }
  catch(error) {
    let message=String(error.stderr||'Git command failed').replace(/https?:\/\/[^\s]+/g,'[remote URL]')
    if(process.env.GH_TOKEN) message=message.replaceAll(process.env.GH_TOKEN,'[redacted]')
    throw new Error(message)
  }
}
if(!process.argv.includes('--publish')) throw new Error('Explicit --publish required. Build and test the app before publishing.')
await access(path.join(dist,'index.html'))
await access(path.join(dist,'.nojekyll'))
for(const entry of await readdir(dist,{recursive:true})) {
  if((await lstat(path.join(dist,entry))).isSymbolicLink()) throw new Error('Refusing to publish a symbolic link.')
  if(entry.split(path.sep).some(part=>part==='.git'||part==='.env'||part.startsWith('.env.'))) throw new Error('Refusing to publish repository metadata or environment files.')
}
const remote=git(['ls-remote','--heads','origin','refs/heads/gh-pages'])
let parent
if(remote) {
  git(['fetch','origin','refs/heads/gh-pages:refs/remotes/origin/gh-pages'])
  parent=git(['rev-parse','refs/remotes/origin/gh-pages'])
  if(git(['show','-s','--format=%s',parent])!=='Deploy PDF Creator & Editor') throw new Error('Existing gh-pages branch is not managed by this publisher; inspect it before changing it.')
}
const temp=await mkdtemp(path.join(tmpdir(),'pdf-pages-index-'))
try {
  const gitDir=git(['rev-parse','--absolute-git-dir'])
  const options={cwd:dist,env:{...process.env,GIT_INDEX_FILE:path.join(temp,'index')}}
  const stage=args=>git([`--git-dir=${gitDir}`,`--work-tree=${dist}`,...args],options)
  stage(['read-tree','--empty'])
  stage(['add','--all'])
  const tree=stage(['write-tree'])
  const args=['commit-tree',tree,...(parent?['-p',parent]:[]),'-m','Deploy PDF Creator & Editor']
  const commit=git(args)
  // No force push: concurrent remote changes abort safely.
  git(['push','origin',`${commit}:refs/heads/gh-pages`])
  git(['update-ref','refs/remotes/origin/gh-pages',commit])
  console.log(`Uploaded tested static app to gh-pages (${commit}).`)
  console.log('This does not enable GitHub Pages or prove the website is live. Verify Pages settings and the deployed URL separately.')
} finally {
  await rm(temp,{recursive:true,force:true})
}
