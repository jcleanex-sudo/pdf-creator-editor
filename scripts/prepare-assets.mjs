import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(path.join(root,'public/pdfjs'), { recursive: true })
for (const dir of ['cmaps','standard_fonts','wasm']) {
  await cp(path.join(root,'node_modules/pdfjs-dist',dir),path.join(root,'public/pdfjs',dir),{ recursive:true })
}
const manifest = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'))
const seen = new Set()
const fontHash=createHash('sha256').update(await readFile(path.join(root,'public/fonts/NotoSansJP-Regular.ttf'))).digest('hex')
const sections = [`PDF Creator & Editor — Third-party notices\n\nGenerated from installed production dependencies.\n\nNoto Sans JP: SIL Open Font License 1.1\nSource: https://github.com/google/fonts/tree/main/ofl/notosansjp\nStatic wght=400 instance generated using FontTools 4.61.1.\nBundled font SHA-256: ${fontHash}\n\n`+await readFile(path.join(root,'public/fonts/OFL.txt'),'utf8')]
async function visit(name,from) {
  let dir = from, candidate, json
  while (true) {
    candidate = path.join(dir,'node_modules',name)
    try { json = JSON.parse(await readFile(path.join(candidate,'package.json'),'utf8')); break } catch {}
    const parent=path.dirname(dir)
    if (parent===dir) throw new Error(`Cannot locate license metadata for ${name}`)
    dir=parent
  }
  if (seen.has(candidate)) return
  seen.add(candidate)
  const licenses=(await readdir(candidate)).filter(file=>/^(license|licence|copying|notice)(\.|$)/i.test(file))
  const content=await Promise.all(licenses.map(async file=>`${file}\n${await readFile(path.join(candidate,file),'utf8')}`))
  let extra=''
  if(json.name==='@pdf-lib/fontkit') {
    const readme=await readFile(path.join(candidate,'README.md'),'utf8')
    const bundle=await readFile(path.join(candidate,'dist/fontkit.es.js'),'utf8')
    const notices=[...new Set((bundle.match(/\/\*[\s\S]*?\*\/|(?:^[ \t]*\/\/[^\n]*\n)+/gm)??[]).filter(block=>/copyright|licensed under|permission is hereby|redistribution and use/i.test(block)))]
    const mit=await readFile(path.join(root,'node_modules/pdf-lib/LICENSE.md'),'utf8').catch(()=>readFile(path.join(root,'node_modules/pdf-lib/LICENSE'),'utf8'))
    extra=`\nThis package declares MIT in package.json and README; it ships no standalone root license file.\n${readme.slice(readme.lastIndexOf('## License'))}\nMIT standard permission/disclaimer text (corresponding to that declaration):\n${mit.slice(mit.indexOf('Permission is hereby'))}\nPreserved bundled component notices (including Joyent MIT and Google Brotli Apache-2.0):\n${notices.join('\n\n')}`
  }
  if(json.name==='pako') extra+='\nZlib component notice:\n'+(await readFile(path.join(candidate,'lib/zlib/deflate.js'),'utf8')).split('\nvar utils')[0]
  sections.push(`${'='.repeat(72)}\n${json.name}@${json.version}\nLicense: ${typeof json.license==='string' ? json.license : JSON.stringify(json.license)}\nAuthor: ${JSON.stringify(json.author??null)}\nContributors: ${JSON.stringify(json.contributors??[])}\n${content.join('\n\n')}${extra}`)
  for (const dependency of Object.keys(json.dependencies ?? {})) await visit(dependency,candidate)
}
for(const name of Object.keys(manifest.dependencies)) await visit(name,root)
// Noto Serif JP is only requested when a serif/Mincho face is needed.
const serifNotice=`\n\nNoto Serif JP — SIL Open Font License 1.1\nSource: https://github.com/google/fonts/tree/main/ofl/notoserifjp\nVariable source SHA-256: 2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc\nStatic wght=400/700 instances generated using FontTools 4.61.1.\n`+await readFile(path.join(root,'public/fonts/OFL-Serif.txt'),'utf8')
await writeFile(path.join(root,'public/THIRD_PARTY_NOTICES.txt'),sections.join('\n\n')+serifNotice)
console.log(`Prepared PDF.js local assets and notices for ${seen.size} production packages.`)
