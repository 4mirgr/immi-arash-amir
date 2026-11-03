export function mixedTextParts(value){
 const source=typeof value==='string'?value:String(value??'');
 const pattern=/[A-Za-z][A-Za-z0-9@._:/?&=%#~+()'’\-–—,; \t]*/g;
 const parts=[];let previous=0;for(const match of source.matchAll(pattern)){
  const run=match[0].replace(/[ \t(]+$/,'');if(match.index>previous)parts.push({text:source.slice(previous,match.index),latin:false});parts.push({text:run,latin:true});previous=match.index+run.length;
 }
 if(previous<source.length)parts.push({text:source.slice(previous),latin:false});return parts;
}
