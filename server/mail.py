"""Private, transport-free mail preparation. This module never sends email."""
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

PROFILES = ('arash', 'amir')
EMAIL = re.compile(r"[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+")


def init_schema(db):
    db.executescript('''
    create table if not exists mail_presets (
      id text primary key, profile_id text not null, name text not null,
      revision integer not null, subject text not null, body text not null,
      created_at text not null, unique(profile_id,name,revision));
    create table if not exists mail_defaults (
      profile_id text primary key, preset_id text not null references mail_presets(id));
    create table if not exists mail_suppressions (
      profile_id text not null, email text not null, reason text not null,
      primary key(profile_id,email));
    create table if not exists mail_queue (
      id text primary key, profile_id text not null, fingerprint text not null,
      created_at text not null, data text not null, unique(profile_id,fingerprint));
    ''')
    db.commit()


def _profile(profile):
    if profile not in PROFILES:
        raise ValueError('Unknown profile')
    return profile


def _text(value, field, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f'{field} must contain 1 to {limit} characters')
    return value.strip()


def _email(value):
    if not isinstance(value, str) or not EMAIL.fullmatch(value.strip()):
        raise ValueError('Valid single email required')
    return value.strip().lower()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _preset(db, profile, id):
    row = db.execute('select id,name,revision,subject,body,created_at from mail_presets where profile_id=? and id=?', (_profile(profile), id)).fetchone()
    if row is None:
        raise ValueError('Unknown preset for this profile')
    return dict(zip(('id','name','revision','subject','body','createdAt'), row))


def list_presets(db, profile):
    profile = _profile(profile)
    default = db.execute('select preset_id from mail_defaults where profile_id=?', (profile,)).fetchone()
    ids = db.execute('select id from mail_presets where profile_id=? order by created_at desc,id', (profile,)).fetchall()
    return [{**_preset(db, profile, row[0]), 'isDefault': bool(default and default[0] == row[0])} for row in ids]


def save_preset(db, profile, payload):
    profile = _profile(profile)
    if not isinstance(payload, dict):
        raise ValueError('Object required')
    name = _text(payload.get('name'), 'name', 120)
    subject = _text(payload.get('subject'), 'subject', 500)
    if '\r' in subject or '\n' in subject:
        raise ValueError('Subject must be a single line')
    body = _text(payload.get('body'), 'body', 50000)
    # Each save creates an immutable revision; queued content never follows later edits.
    with db:
        revision = db.execute('select coalesce(max(revision),0)+1 from mail_presets where profile_id=? and name=?', (profile,name)).fetchone()[0]
        id = str(uuid.uuid4())
        db.execute('insert into mail_presets values (?,?,?,?,?,?,?)', (id,profile,name,revision,subject,body,_now()))
    return _preset(db, profile, id)


def set_default_preset(db, profile, id):
    item = _preset(db, profile, id)
    with db:
        db.execute('insert or replace into mail_defaults values (?,?)', (profile,id))
    return {**item, 'isDefault': True}


def delete_preset(db, profile, id):
    item = _preset(db, profile, id)
    with db:
        db.execute('delete from mail_defaults where profile_id=? and preset_id=?', (profile,id))
        db.execute('delete from mail_presets where profile_id=? and id=?', (profile,id))
    return {'deleted': True, 'id': item['id'], 'profileId': profile}


def suppress(db, profile, email, reason='User suppression'):
    profile = _profile(profile)
    email = _email(email)
    reason = _text(reason, 'reason', 500)
    with db:
        db.execute('insert or replace into mail_suppressions values (?,?,?)', (profile,email,reason))
        # Already prepared items remain in the audit trail but cannot be treated as sendable.
        for id, raw in db.execute('select id,data from mail_queue where profile_id=?', (profile,)).fetchall():
            item = json.loads(raw)
            if item['email'] == email:
                item['status'] = 'suppressed'
                db.execute('update mail_queue set data=? where id=?', (json.dumps(item), id))
    return {'email':email, 'suppressed':True}


def _content(db, profile, payload):
    preset_id = payload.get('presetId')
    if preset_id:
        preset = _preset(db, profile, preset_id)
        subject, body = preset['subject'], preset['body']
    else:
        subject = _text(payload.get('subject'), 'subject', 500)
        body = _text(payload.get('body'), 'body', 50000)
        preset = None
    if '\r' in subject or '\n' in subject:
        raise ValueError('Subject must be a single line')
    cv_id = payload.get('cvVersionId')
    if cv_id:
        from server.cv import get_version
        get_version(db, profile, cv_id)  # Reject foreign or missing private CV IDs.
    return subject, body, preset, cv_id


def _prepare(db, profile, payload, daily_limit):
    profile = _profile(profile)
    if not isinstance(payload, dict):
        raise ValueError('Object required')
    for field in ('presetId', 'cvVersionId'):
        if payload.get(field) is not None and not isinstance(payload[field], str):
            raise ValueError(f'{field} must be a string')
    if not isinstance(daily_limit,int) or isinstance(daily_limit,bool) or not 1 <= daily_limit <= 200:
        raise ValueError('Daily limit must be 1 to 200')
    ids = payload.get('clinicIds')
    if not isinstance(ids,list) or not 1 <= len(ids) <= 200 or any(not isinstance(id,str) for id in ids):
        raise ValueError('Select 1 to 200 clinic IDs')
    subject, body, preset, cv_id = _content(db, profile, payload)
    recipients = {}
    excluded = []
    for clinic_id in dict.fromkeys(ids):
        row = db.execute('select data from clinics where id=?', (clinic_id,)).fetchone()
        if row is None:
            raise ValueError('Unknown clinic')
        clinic = json.loads(row[0])
        try:
            email = _email(clinic.get('email'))
        except ValueError:
            excluded.append({'clinicId':clinic_id,'reason':'missing_or_invalid_email'})
            continue
        if db.execute('select 1 from mail_suppressions where profile_id=? and email=?', (profile,email)).fetchone():
            excluded.append({'clinicId':clinic_id,'reason':'suppressed'})
            continue
        if email in recipients:
            recipients[email]['clinicIds'].append(clinic_id)
            continue
        immutable = dict(email=email,subject=subject,body=body,cvVersionId=cv_id)
        fingerprint = hashlib.sha256(json.dumps(immutable,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        existing = db.execute('select id from mail_queue where profile_id=? and fingerprint=?', (profile,fingerprint)).fetchone()
        recipients[email] = dict(**immutable,clinicIds=[clinic_id],presetId=preset['id'] if preset else None,
                                 presetRevision=preset['revision'] if preset else None,
                                 fingerprint=fingerprint,existingId=existing[0] if existing else None,
                                 status='blocked_integration')
    today = datetime.now(timezone.utc).date().isoformat()
    reserved = db.execute('select count(*) from mail_queue where profile_id=? and substr(created_at,1,10)=?', (profile,today)).fetchone()[0]
    new_count = sum(not row['existingId'] for row in recipients.values())
    return {'recipients':list(recipients.values()), 'excluded':excluded,'newCount':new_count,
            'dailyLimit':daily_limit,'reservedToday':reserved,'quotaAvailable':max(0,daily_limit-reserved),
            'withinQuota':reserved + new_count <= daily_limit,'sendingEnabled':False,
            'integrationStatus':'gmail_not_connected','quotaTimezone':'UTC'}


def preview_queue(db, profile, payload, daily_limit=20):
    """Read-only dry run; selected recipients and skipped records are explicit."""
    return _prepare(db, profile, payload, daily_limit)


def enqueue(db, profile, payload, daily_limit=20):
    """Reserve an idempotent blocked queue batch, with quota check under write lock."""
    if db.in_transaction:
        raise ValueError('Commit existing transaction before enqueue')
    db.execute('begin immediate')
    try:
        preview = _prepare(db, profile, payload, daily_limit)
        if not preview['recipients']:
            raise ValueError('No valid unsuppressed recipients selected')
        if not preview['withinQuota']:
            raise ValueError('Daily preparation quota exceeded')
        results = []
        for recipient in preview['recipients']:
            if recipient['existingId']:
                raw = db.execute('select data from mail_queue where id=? and profile_id=?', (recipient['existingId'],profile)).fetchone()[0]
                results.append({**json.loads(raw),'reused':True})
                continue
            id, created = str(uuid.uuid4()), _now()
            item = {k:v for k,v in recipient.items() if k not in ('fingerprint','existingId')}
            item.update(id=id,profileId=profile,createdAt=created,reused=False)
            db.execute('insert into mail_queue values (?,?,?,?,?)', (id,profile,recipient['fingerprint'],created,json.dumps(item)))
            results.append(item)
        db.commit()
        return {'items':results,'excluded':preview['excluded'],'sendingEnabled':False}
    except Exception:
        db.rollback()
        raise


def list_queue(db, profile):
    return [json.loads(row[0]) for row in db.execute('select data from mail_queue where profile_id=? order by created_at desc,id', (_profile(profile),))]
