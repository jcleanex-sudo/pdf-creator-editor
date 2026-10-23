import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, type PDFDocument, type PDFObject } from 'pdf-lib'

export const existingObjects=(pdf:PDFDocument)=>new Set(pdf.context.enumerateIndirectObjects().map(([ref])=>ref.toString()))

/** Share only byte-for-byte identical font program streams created by this
 * operation. Original streams, encodings, glyph IDs and CMaps stay intact. */
export async function compactNewFonts(pdf:PDFDocument,original:Set<string>){
  await pdf.flush()
  const objects=pdf.context.enumerateIndirectObjects(),programs=new Set<PDFRef>()
  for(const[,object]of objects)if(object instanceof PDFDict&&object.get(PDFName.of('Type'))===PDFName.of('FontDescriptor')){
    for(const key of ['FontFile','FontFile2','FontFile3']){
      const ref=object.get(PDFName.of(key));if(ref instanceof PDFRef)programs.add(ref)
    }
  }
  // Reordering or adding blank pages introduces no font data. Avoid reading
  // every existing program again in large documents in that case.
  if(![...programs].some(ref=>!original.has(ref.toString())))return
  const buckets=new Map<string,{ref:PDFRef;stream:PDFRawStream}[]>(),replacements=new Map<string,PDFRef>()
  for(const ref of programs){
    const stream=pdf.context.lookup(ref)
    if(!(stream instanceof PDFRawStream))continue
    // The complete dictionary participates, including compression/subtype.
    const dictionary=stream.dict.entries().filter(([key])=>key!==PDFName.of('Length')).map(([key,value])=>[key.toString(),value.toString()]).sort((a,b)=>a[0].localeCompare(b[0]))
    let hash=2166136261
    for(const byte of stream.contents)hash=Math.imul(hash^byte,16777619)
    const key=JSON.stringify(dictionary)+':'+stream.contents.length+':'+hash,bucket=buckets.get(key)??[]
    const same=bucket.find(value=>stream.contents.every((byte,index)=>byte===value.stream.contents[index]))
    if(same&&!original.has(ref.toString()))replacements.set(ref.toString(),same.ref)
    else{bucket.push({ref,stream});buckets.set(key,bucket)}
  }
  if(!replacements.size)return
  const seen=new Set<PDFObject>()
  function visit(object:PDFObject){
    if(seen.has(object))return;seen.add(object)
    if(object instanceof PDFRawStream){visit(object.dict);return}
    if(object instanceof PDFDict)for(const[key,value]of object.entries()){
      const replacement=value instanceof PDFRef?replacements.get(value.toString()):undefined
      if(replacement)object.set(key,replacement);else visit(value)
    }
    if(object instanceof PDFArray)for(let index=0;index<object.size();index++){
      const value=object.get(index),replacement=value instanceof PDFRef?replacements.get(value.toString()):undefined
      if(replacement)object.set(index,replacement);else visit(value)
    }
  }
  // Traverse direct containers only; indirect references are visited through
  // the context list. No font stream is deleted until every ref is redirected.
  for(const[,object]of objects)visit(object)
  for(const[ref]of objects)if(replacements.has(ref.toString()))pdf.context.delete(ref)
}
