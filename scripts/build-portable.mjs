import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const dist=path.join(root,'dist')
let html=await readFile(path.join(dist,'index.html'),'utf8')
const b64=async file=>(await readFile(file)).toString('base64')
const resources={}
let notices=await readFile(path.join(dist,'THIRD_PARTY_NOTICES.txt'),'utf8')
for(const folder of ['cmaps','standard_fonts','wasm']) {
  for(const name of await readdir(path.join(dist,'pdfjs',folder))) {
    const file=path.join(dist,'pdfjs',folder,name)
    resources[`${folder}/${name}`]=await b64(file)
    if(/license|notice/i.test(name)) notices+=`\n\n${folder}/${name}\n${await readFile(file,'utf8')}`
  }
}
const worker=await readFile(path.join(root,'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),'utf8')
const bundle={font:await b64(path.join(dist,'fonts/NotoSansJP-Regular.ttf')),boldFont:await b64(path.join(dist,'fonts/NotoSansJP-Bold.ttf')),worker,resources,notices}
// Escape '<' to prevent any bundled source/notices from closing a script element.
const payload=JSON.stringify(bundle).replaceAll('<','\\u003c')
html=html.replace('</head>',()=>`<script>globalThis.__PDF_EDITOR_PORTABLE__=${payload};</script></head>`)
const scriptTags=[...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)]
if(scriptTags.length!==1) throw new Error('Expected one application entry script; review the portable bundler for a changed Vite output layout.')
for(const [tag,,url] of scriptTags) {
  const js=await readFile(path.join(dist,url),'utf8')
  if(/\bfrom\s*["']\.\.?\//.test(js)) throw new Error('Application has external chunks; portable output must remain self-contained.')
  html=html.replace(tag,()=>`<script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`)
}
for(const [tag,url] of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
  let css=await readFile(path.join(dist,url),'utf8')
  let fonts=0
  css=css.replace(/url\((?:["'])?[^)]*NotoSansJP-Regular\.ttf(?:["'])?\)/g,()=>{fonts++;return `url(data:font/ttf;base64,${bundle.font})`})
  if(fonts!==1) throw new Error('Expected exactly one embedded UI font.')
  if(/url\((?!["']?(?:data:|#))/.test(css)) throw new Error('Unresolved CSS resource in portable build.')
  html=html.replace(tag,()=>`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`)
}
const favicon=await b64(path.join(dist,'favicon.svg'))
html=html.replace(/href="(?:\.\/)?favicon\.svg"/g,`href="data:image/svg+xml;base64,${favicon}"`)
if(/<(?:script|link)[^>]*(?:src|href)="(?:\.\/|\/|https?:)/.test(html)) throw new Error('External entry resources remain in portable build.')
const release=path.join(root,'release')
await mkdir(release,{recursive:true})
const output=path.join(release,'PDF-Editor.html')
await writeFile(output,html)
await writeFile(path.join(release,'LICENSES.txt'),notices)
console.log(`Portable Chrome application: ${output} (${(Buffer.byteLength(html)/1024/1024).toFixed(1)} MB). Open the HTML directly; no server is required.`)
