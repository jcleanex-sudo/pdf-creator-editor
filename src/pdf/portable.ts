type PortableAssets = {
  font: string
  worker: string
  resources: Record<string,string>
  notices: string
}

declare global {
  var __PDF_EDITOR_PORTABLE__: PortableAssets | undefined
}

export function portableAssets() {
  return globalThis.__PDF_EDITOR_PORTABLE__
}

export function decodeBase64(value: string) {
  const binary=atob(value)
  const bytes=new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i)
  return bytes
}

// PDF.js 6's supported BinaryDataFactory interface. No fetch, local server,
// or file:// cross-origin access is needed for CMaps, standard fonts or WASM.
export class EmbeddedBinaryDataFactory {
  async fetch({kind,filename}:{kind:string;filename:string}) {
    const folders:Record<string,string>={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'}
    const folder=folders[kind]
    if(!folder || !/^[a-zA-Z0-9_.-]+$/.test(filename)) throw new Error('Unknown embedded PDF resource')
    const encoded=portableAssets()?.resources[`${folder}/${filename}`]
    if(!encoded) throw new Error(`Embedded PDF resource missing: ${filename}`)
    return decodeBase64(encoded)
  }
}

let licenseUrl:string|undefined
export function getLicenseUrl() {
  const assets=portableAssets()
  if(!assets) return `${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`
  licenseUrl??=URL.createObjectURL(new Blob([assets.notices],{type:'text/plain;charset=utf-8'}))
  return licenseUrl
}
