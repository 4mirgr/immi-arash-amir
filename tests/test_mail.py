import json
import tempfile
import unittest
from server.app import connect,initialize
from server.mail import init_schema,save_preset,list_presets,set_default_preset,delete_preset,preview_queue,enqueue,list_queue,suppress

class MailTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=connect(self.tmp.name)
        initialize(self.db)
        init_schema(self.db)
        for id,email in [('a','Hello@Example.com'),('b','hello@example.com'),('c','-'),('d','other@example.com')]:
            self.db.execute('insert into clinics values (?,?)',(id,json.dumps(dict(id=id,name=id,email=email))))
        self.db.commit()
        self.payload={'clinicIds':['a','b','c'],'subject':'Application','body':'Synthetic example'}
    def tearDown(self):
        self.db.close();self.tmp.cleanup()
    def test_preset_revision_default_and_owner_isolation(self):
        a=save_preset(self.db,'arash',{'name':'Intro','subject':'One','body':'Body'})
        b=save_preset(self.db,'arash',{'name':'Intro','subject':'Two','body':'New body'})
        self.assertEqual((a['revision'],b['revision']),(1,2))
        set_default_preset(self.db,'arash',b['id'])
        self.assertEqual(list_presets(self.db,'amir'),[])
        self.assertTrue(next(p for p in list_presets(self.db,'arash') if p['id']==b['id'])['isDefault'])
        with self.assertRaises(ValueError):set_default_preset(self.db,'amir',a['id'])
    def test_delete_only_owned_template_version_clears_default_and_preserves_prepared_mail(self):
        a=save_preset(self.db,'arash',{'name':'Intro','subject':'Original','body':'Original body'})
        b=save_preset(self.db,'arash',{'name':'Intro','subject':'Later','body':'Later body'})
        other=save_preset(self.db,'amir',{'name':'Other','subject':'Private','body':'Private body'})
        set_default_preset(self.db,'arash',a['id'])
        set_default_preset(self.db,'amir',other['id'])
        queued=enqueue(self.db,'arash',{'clinicIds':['a'],'presetId':a['id']})['items'][0]
        with self.assertRaises(ValueError):delete_preset(self.db,'amir',a['id'])
        result=delete_preset(self.db,'arash',a['id'])
        self.assertTrue(result['deleted'])
        self.assertEqual([p['id'] for p in list_presets(self.db,'arash')],[b['id']])
        self.assertFalse(list_presets(self.db,'arash')[0]['isDefault'])
        self.assertTrue(list_presets(self.db,'amir')[0]['isDefault'])
        self.assertEqual(list_queue(self.db,'arash')[0]['subject'],'Original')
        self.assertEqual(list_queue(self.db,'arash')[0]['id'],queued['id'])
        with self.assertRaises(ValueError):delete_preset(self.db,'arash',a['id'])

    def test_preview_deduplicates_mailboxes_without_writing(self):
        p=preview_queue(self.db,'arash',self.payload)
        self.assertEqual(len(p['recipients']),1)
        self.assertEqual(p['recipients'][0]['clinicIds'],['a','b'])
        self.assertEqual(p['excluded'][0]['reason'],'missing_or_invalid_email')
        self.assertEqual(list_queue(self.db,'arash'),[])
    def test_queue_idempotence_and_isolation(self):
        first=enqueue(self.db,'arash',self.payload)['items'][0]
        second=enqueue(self.db,'arash',self.payload)['items'][0]
        self.assertEqual(first['id'],second['id'])
        self.assertTrue(second['reused'])
        self.assertEqual(second['status'],'blocked_integration')
        self.assertEqual(list_queue(self.db,'amir'),[])
        self.assertEqual(len(list_queue(self.db,'arash')),1)
    def test_queued_template_snapshot_is_immutable(self):
        preset=save_preset(self.db,'arash',{'name':'Intro','subject':'Original','body':'Original body'})
        payload={'clinicIds':['a'],'presetId':preset['id']}
        queued=enqueue(self.db,'arash',payload)['items'][0]
        save_preset(self.db,'arash',{'name':'Intro','subject':'Changed','body':'Changed body'})
        self.assertEqual(list_queue(self.db,'arash')[0]['subject'],'Original')
        self.assertEqual(queued['presetRevision'],1)
    def test_daily_quota_counts_prepared_and_idempotent_retry_allowed(self):
        enqueue(self.db,'arash',{'clinicIds':['a'],'subject':'Hi','body':'Body'},daily_limit=1)
        enqueue(self.db,'arash',{'clinicIds':['a'],'subject':'Hi','body':'Body'},daily_limit=1)
        with self.assertRaises(ValueError):
            enqueue(self.db,'arash',{'clinicIds':['d'],'subject':'Hi','body':'Body'},daily_limit=1)
        self.assertEqual(len(list_queue(self.db,'arash')),1)
    def test_suppression_blocks_existing_and_future_records(self):
        enqueue(self.db,'arash',self.payload)
        suppress(self.db,'arash','HELLO@example.com','Do not contact')
        self.assertEqual(list_queue(self.db,'arash')[0]['status'],'suppressed')
        with self.assertRaises(ValueError):enqueue(self.db,'arash',self.payload)
        self.assertEqual(preview_queue(self.db,'amir',self.payload)['newCount'],1)
    def test_cv_reference_must_belong_to_queue_owner(self):
        from server import cv
        cv.init_schema(self.db)
        self.db.execute('update profiles set data=? where id=?',(json.dumps({'cvText':'Synthetic CV only'}),'arash'))
        self.db.commit()
        version=cv.create_version(self.db,'arash',{'name':'Example'})
        saved=enqueue(self.db,'arash',{**self.payload,'cvVersionId':version['id']})
        self.assertEqual(saved['items'][0]['cvVersionId'],version['id'])
        with self.assertRaises(ValueError):
            enqueue(self.db,'amir',{**self.payload,'cvVersionId':version['id']})
        self.assertEqual(list_queue(self.db,'amir'),[])

    def test_invalid_profile_unknown_recipient_header_and_foreign_preset(self):
        preset=save_preset(self.db,'arash',{'name':'Intro','subject':'Hello','body':'Body'})
        for profile,payload in [('evil',self.payload),('arash',{**self.payload,'clinicIds':['missing']}),('arash',{**self.payload,'subject':'Hi\nBcc: other@example.com'}),('amir',{'clinicIds':['a'],'presetId':preset['id']})]:
            with self.assertRaises(ValueError):enqueue(self.db,profile,payload)
        self.assertEqual(list_queue(self.db,'arash'),[])

if __name__=='__main__':unittest.main()
