import json,tempfile,unittest,zipfile
from xml.sax.saxutils import escape
from pathlib import Path
from server.app import connect,initialize,save_draft,list_drafts,load_stations
from scripts.import_documents import record,import_folder
class BackendTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.db=connect(self.tmp.name);initialize(self.db)
    def tearDown(self):self.db.close();self.tmp.cleanup()
    def test_email_dedup_case_and_stable_id(self):
        a=record({'نام مرکز':'A','ایمیل':'Reception@EXAMPLE.com'},{}); b=record({'نام مرکز':'B','ایمیل':'reception@example.COM'}, {})
        self.assertEqual(a['id'],b['id'])
        self.assertEqual(a['email'],'reception@example.com')
    def test_missing_emails_do_not_merge_different_places(self):
        a=record({'نام مرکز':'A','ایمیل':'-'},{});b=record({'نام مرکز':'B','ایمیل':'-'},{})
        self.assertNotEqual(a['id'],b['id']);self.assertEqual(a['email'],'')
    def test_profile_drafts_are_scoped(self):
        saved=save_draft(self.db,{'profileId':'arash','subject':'Hello','body':'Application','clinicIds':[]})
        self.assertEqual(list_drafts(self.db,'arash')[0]['id'],saved['id'])
        self.assertEqual(list_drafts(self.db,'amir'),[])
    def test_unknown_profile_and_recipients_rejected(self):
        for data in [{'profileId':'evil','subject':'x','body':'x'}, {'profileId':'arash','subject':'x','body':'x','clinicIds':['missing']}]:
            with self.assertRaises(ValueError):save_draft(self.db,data)
    def test_import_empty_folder_is_safe(self):
        result=import_folder(self.tmp.name,self.tmp.name)
        self.assertEqual(result['uniqueClinics'],0)
    def test_real_zip_parsers_idempotence_and_provenance(self):
        folder=Path(self.tmp.name)/'attachments';folder.mkdir()
        shared=['نام مرکز','ایمیل','Suburb','State','Synthetic Clinic','RECEPTION@example.test','Demo City','Victoria','reception@EXAMPLE.TEST']
        strings='<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+''.join('<si><t>'+escape(x)+'</t></si>' for x in shared)+'</sst>'
        rows=[[0,1,2,3],[4,5,6,7],[4,8,6,7]]
        sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        for n,row in enumerate(rows,1):
            sheet+='<row r="'+str(n)+'">'+''.join(f'<c r="{chr(65+i)}{n}" t="s"><v>{v}</v></c>' for i,v in enumerate(row))+'</row>'
        sheet+='</sheetData></worksheet>'
        with zipfile.ZipFile(folder/'synthetic.xlsx','w') as z:
            z.writestr('xl/sharedStrings.xml',strings);z.writestr('xl/worksheets/sheet1.xml',sheet)
        with zipfile.ZipFile(folder/'synthetic.docx','w') as z:
            z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic clinician CV</w:t></w:r></w:p></w:body></w:document>')
        with zipfile.ZipFile(folder/'z-alternative.docx','w') as z:
            z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Alternative synthetic CV</w:t></w:r></w:p></w:body></w:document>')
        first=import_folder(folder,self.tmp.name);second=import_folder(folder,self.tmp.name)
        self.assertEqual(first['sourceRows'],2);self.assertEqual(first['uniqueClinics'],1)
        self.assertEqual(second['uniqueClinics'],1)
        record=json.loads(self.db.execute('select data from clinics').fetchone()[0])
        self.assertEqual(record['email'],'reception@example.test')
        self.assertEqual({s['row'] for s in record['sources']},{2,3})
        self.assertEqual(len(record['sources']),2)
        profile=json.loads(self.db.execute("select data from profiles where id='arash'").fetchone()[0])
        self.assertEqual(profile['cvText'],'Synthetic clinician CV')
        self.assertEqual(profile['documents'][0]['filename'],'synthetic.docx')
        self.assertEqual(profile['cvSource'],'synthetic.docx')
        self.assertEqual(len(profile['documents']),2)
        self.assertEqual(profile['documents'][1]['text'],'Alternative synthetic CV')
        self.assertNotIn('Alternative',profile['cvText'])
    def test_library_station_mapping_and_fallback(self):
        stations=load_stations()
        self.assertTrue(stations)
        self.assertEqual(stations[0]['prompt'],stations[0]['case'])
        self.assertEqual(stations[0]['questions'],stations[0]['prompts'])
        self.assertFalse(stations[0]['official_exam_item'])
        self.assertTrue(load_stations(Path(self.tmp.name)/'missing')[0]['educational'])
if __name__=='__main__':unittest.main()
