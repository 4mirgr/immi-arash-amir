import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocx,xmlText} from '../cloud/docx.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('DOCX archive passes ZIP CRC and XML parsing with untrusted multilingual text',()=>{
  const folder=mkdtempSync(join(tmpdir(),'immi-docx-'));
  try {
    const path=join(folder,'sample.docx');
    writeFileSync(path,createDocx('Doctor & <tag>\nرزومه — 🩺\u0000\u0001'));
    const check=spawnSync('python',['-c',`import zipfile,sys,xml.etree.ElementTree as ET
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert set(z.namelist()) == {'[Content_Types].xml','_rels/.rels','word/document.xml'}
 for name in z.namelist(): ET.fromstring(z.read(name))
 root=ET.fromstring(z.read('word/document.xml'))
 text=''.join(root.itertext())
 assert text == 'Doctor & <tag>رزومه — 🩺'
`,path],{encoding:'utf8'});
    assert.equal(check.status,0,check.stderr);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
test('XML content escapes entities and removes forbidden controls',()=>{
  assert.equal(xmlText('<a>&\u0000\u0001\t\n'), '&lt;a&gt;&amp;\t\n');
});
