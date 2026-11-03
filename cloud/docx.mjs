// Minimal dependency-free OOXML document in a stored ZIP archive.
// All entry paths are fixed, and supplied CV text is XML-escaped.
const encoder = new TextEncoder();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit=0;bit<8;bit++) crc = (crc>>>1) ^ ((crc&1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function xmlText(value) {
  return Array.from(value).filter(char => {
    const n=char.codePointAt(0);
    return n===9||n===10||n===13||(n>=0x20&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff);
  }).join('').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}
function storedZip(entries) {
  const parts=[], directory=[];let offset=0,centralSize=0;
  for(const [filename,value] of entries) {
    const name=encoder.encode(filename), bytes=encoder.encode(value), checksum=crc32(bytes);
    const local=new Uint8Array(30+name.length);const lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(10,0,true);lv.setUint16(12,33,true);
    lv.setUint32(14,checksum,true);lv.setUint32(18,bytes.length,true);lv.setUint32(22,bytes.length,true);lv.setUint16(26,name.length,true);local.set(name,30);
    parts.push(local,bytes);
    const central=new Uint8Array(46+name.length);const cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(14,33,true);
    cv.setUint32(16,checksum,true);cv.setUint32(20,bytes.length,true);cv.setUint32(24,bytes.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.set(name,46);
    directory.push(central);centralSize+=central.length;offset+=local.length+bytes.length;
  }
  const footer=new Uint8Array(22);const fv=new DataView(footer.buffer);
  fv.setUint32(0,0x06054b50,true);fv.setUint16(8,entries.length,true);fv.setUint16(10,entries.length,true);fv.setUint32(12,centralSize,true);fv.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralSize+footer.length);let cursor=0;
  for(const item of [...parts,...directory,footer]) {result.set(item,cursor);cursor+=item.length;}
  return result;
}
export function createDocx(text) {
  const document='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+text.split('\n').map(line=>'<w:p><w:r><w:t xml:space="preserve">'+xmlText(line)+'</w:t></w:r></w:p>').join('')+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
  return storedZip([
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml',document]
  ]);
}
