"""Synthetic HTTP contract checks; never reads the user's private database."""
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from server.app import Handler, connect, initialize

class HttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.env = patch.dict(os.environ, {'IMMI_DATA_DIR': cls.tmp.name})
        cls.env.start()
        db = connect(); initialize(db)
        db.execute('update profiles set data=? where id=?', (json.dumps({'id':'arash','cvText':'Synthetic physician CV','cvSource':'synthetic.docx'}),'arash'))
        db.commit(); db.close()
        cls.http = ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:'+str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()
        cls.env.stop(); cls.tmp.cleanup()
    def request(self, path, body=None, origin=None):
        headers={'Content-Type':'application/json'}
        if origin: headers['Origin']=origin
        req=Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
        try:
            with urlopen(req) as r: return r.status,r.headers,r.read()
        except HTTPError as e: return e.code,e.headers,e.read()
    def test_gate_config(self):
        status,_,raw=self.request('/api/public-config')
        self.assertEqual(status,200)
        self.assertEqual(json.loads(raw),{'mode':'local_demo','authRequired':False})
    def test_cv_snapshot_export_and_foreign_id(self):
        status,_,raw=self.request('/api/cv/versions?profile=arash',{'name':'HTTP snapshot'})
        self.assertEqual(status,201); version=json.loads(raw)['id']
        status,headers,raw=self.request('/api/cv/export?profile=arash&id='+version+'&format=docx')
        self.assertEqual(status,200); self.assertTrue(raw.startswith(b'PK'))
        self.assertIn('attachment',headers['Content-Disposition'])
        status,_,_=self.request('/api/cv/export?profile=amir&id='+version)
        self.assertEqual(status,400)
    def test_presets_are_profile_scoped(self):
        status,_,raw=self.request('/api/presets?profile=arash',{'name':'Intro','subject':'Synthetic','body':'No real message'})
        self.assertEqual(status,201)
        id=json.loads(raw)['id']
        self.assertEqual(self.request('/api/presets/default?profile=amir',{'id':id})[0],400)
        self.assertEqual(json.loads(self.request('/api/presets?profile=amir')[2]),[])
    def test_foreign_origin_rejected(self):
        self.assertEqual(self.request('/api/public-config',origin='https://untrusted.example')[0],403)
