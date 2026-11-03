"""Import user-provided records locally. Standard library only; originals never copied."""
import argparse, hashlib, json, re, sys, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.app import connect, initialize
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def clean(v):
    v=str(v or '').strip()
    return '' if v in ('-', '—', 'None') else v

def xlsx_rows(path):
    with zipfile.ZipFile(path) as z:
        strings=[''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        for sheet in sorted(n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+.xml',n)):
            rows=[]
            for row in ET.fromstring(z.read(sheet)).findall('.//s:row',NS):
                cells={}
                for c in row:
                    col=re.sub(r'\d','',c.attrib['r']); v=c.find('s:v',NS)
                    cells[col]=strings[int(v.text)] if c.attrib.get('t')=='s' and v is not None else ''.join(c.itertext())
                rows.append(cells)
            if not rows: continue
            headers=rows[0]
            for number,row in enumerate(rows[1:],2):
                yield sheet,number,{headers.get(k,k):clean(v) for k,v in row.items()}

def record(row,source):
    name=row.get('نام مرکز',''); email=row.get('ایمیل','').strip().lower()
    if not name: return None
    # Only valid single mailbox values become email identity keys.
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): email=''
    city=row.get('Suburb',''); address=row.get('آدرس','')
    key='email:'+email if email else 'place:'+name.casefold()+'|'+address.casefold()+'|'+city.casefold()
    return dict(id='cl_'+hashlib.sha256(key.encode()).hexdigest()[:20],name=name,email=email,phone=row.get('تلفن',''),website=row.get('آدرس وبسايت',''),address=address,city=city,state=row.get('State',''),postcode=row.get('Postcode',''),status='imported_unverified',monash=None,source=source,sources=[source])

def import_folder(folder,data_dir='private'):
    db=connect(data_dir); initialize(db); count=0; duplicates=0
    for path in sorted(Path(folder).glob('*.xlsx')):
        for sheet,n,row in xlsx_rows(path):
            item=record(row,dict(file=path.name,sheet=sheet,row=n))
            if not item: continue
            count+=1; old=db.execute('select data from clinics where id=?',(item['id'],)).fetchone()
            if old:
                duplicates+=1; existing=json.loads(old[0]); existing['sources']=list({json.dumps(s,sort_keys=True):s for s in existing.get('sources',[])+item['sources']}.values())
                for k,v in item.items():
                    if not existing.get(k) and v: existing[k]=v
                item=existing
            db.execute('insert or replace into clinics values (?,?)',(item['id'],json.dumps(item,ensure_ascii=False)))
    docs=[]
    for path in sorted(Path(folder).glob('*.docx')):
        with zipfile.ZipFile(path) as z:
            tree=ET.fromstring(z.read('word/document.xml'))
            text='\n'.join(''.join(p.itertext()) for p in tree.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
            docs.append({'filename':path.name,'text':text})
    if docs:
        profile=json.loads(db.execute("select data from profiles where id='arash'").fetchone()[0]); profile.update(cvText=docs[0]['text'],cvSource=docs[0]['filename'],documents=docs)
        db.execute("update profiles set data=? where id='arash'",(json.dumps(profile,ensure_ascii=False),))
    db.commit(); unique=db.execute('select count(*) from clinics').fetchone()[0]; db.close()
    return {'sourceRows':count,'duplicateRows':duplicates,'uniqueClinics':unique,'documents':len(docs)}

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('folder'); p.add_argument('--data-dir',default='private'); args=p.parse_args()
    print(json.dumps(import_folder(args.folder,args.data_dir)))
