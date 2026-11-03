"""Immutable, owner-scoped CV snapshots. No generated achievements or external calls."""
import hashlib
import io
import json
import uuid
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

PROFILES = ('arash', 'amir')
MAX_TEXT = 200_000


def _profile(value):
    if value not in PROFILES:
        raise ValueError('Unknown profile')
    return value


def init_schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS cv_versions (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
        version INTEGER NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
        source_hash TEXT NOT NULL, source_filename TEXT NOT NULL,
        verification TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(profile_id, version))''')
    db.execute('''CREATE TABLE IF NOT EXISTS cv_defaults (
        profile_id TEXT PRIMARY KEY, version_id TEXT NOT NULL
        REFERENCES cv_versions(id))''')
    db.commit()


def _metadata(row, default_id=None):
    return dict(id=row[0], profileId=row[1], version=row[2], name=row[3],
                sourceHash=row[5], sourceFilename=row[6], verification=row[7],
                createdAt=row[8], isDefault=row[0] == default_id)


def _default(db, profile):
    row = db.execute('SELECT version_id FROM cv_defaults WHERE profile_id=?', (profile,)).fetchone()
    return row[0] if row else None


def list_versions(db, profile):
    profile = _profile(profile)
    default_id = _default(db, profile)
    return [_metadata(row, default_id) for row in db.execute(
        'SELECT * FROM cv_versions WHERE profile_id=? ORDER BY version DESC', (profile,))]


def create_version(db, profile, payload):
    """Snapshot existing private profile cvText; client cannot supply CV content."""
    profile = _profile(profile)
    if not isinstance(payload, dict):
        raise ValueError('Object required')
    if set(payload) - {'name', 'expectedSourceHash'}:
        raise ValueError('Only name and expectedSourceHash are accepted')
    name = payload.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
        raise ValueError('Template name must contain 1 to 120 characters')
    name = name.strip()
    if any(ord(char) < 32 for char in name):
        raise ValueError('Template name contains control characters')
    row = db.execute('SELECT data FROM profiles WHERE id=?', (profile,)).fetchone()
    if not row:
        raise ValueError('Profile not found')
    source = json.loads(row[0])
    text = source.get('cvText', '')
    if not isinstance(text, str) or not text.strip():
        raise ValueError('Import or complete this profile CV before saving a version')
    if len(text) > MAX_TEXT:
        raise ValueError('CV text exceeds snapshot limit')
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    expected = payload.get('expectedSourceHash')
    if expected is not None and expected != digest:
        raise ValueError('CV source changed; refresh before saving a version')
    version_id = str(uuid.uuid4())
    # A single write lock prevents concurrent snapshots sharing a version number.
    with db:
        db.execute('INSERT INTO cv_versions VALUES (?, ?, '
                   '(SELECT COALESCE(MAX(version),0)+1 FROM cv_versions WHERE profile_id=?), '
                   '?, ?, ?, ?, ?, ?)',
                   (version_id, profile, profile, name, text, digest,
                    str(source.get('cvSource', '')),
                    str(source.get('verification', 'user_supplied_unverified')),
                    datetime.now(timezone.utc).isoformat()))
    row = db.execute('SELECT * FROM cv_versions WHERE id=?', (version_id,)).fetchone()
    return _metadata(row, _default(db, profile))


def _version(db, profile, version_id):
    profile = _profile(profile)
    if not isinstance(version_id, str):
        raise ValueError('Version ID required')
    row = db.execute('SELECT * FROM cv_versions WHERE profile_id=? AND id=?',
                     (profile, version_id)).fetchone()
    if not row:
        # Same response for missing and foreign IDs: do not disclose ownership.
        raise ValueError('CV version not found')
    return row


def get_version(db, profile, version_id):
    """Return metadata after ownership validation, without disclosing CV content."""
    row = _version(db, profile, version_id)
    return _metadata(row, _default(db, profile))


def set_default(db, profile, version_id):
    row = _version(db, profile, version_id)
    with db:
        db.execute('INSERT OR REPLACE INTO cv_defaults VALUES (?,?)', (profile, version_id))
    return _metadata(row, version_id)


def _xml_text(text):
    # XML 1.0 excludes control characters even when escaped.
    valid = ''.join(char for char in text if char in '\t\n\r' or
                    0x20 <= ord(char) <= 0xD7FF or
                    0xE000 <= ord(char) <= 0xFFFD or
                    0x10000 <= ord(char) <= 0x10FFFF)
    return escape(valid)


def _docx(text):
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body>' + ''.join('<w:p><w:r><w:t xml:space="preserve">' +
                _xml_text(line) + '</w:t></w:r></w:p>' for line in text.split('\n')) +
                '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
                '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>'
                '</w:sectPr></w:body></w:document>')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        archive.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        archive.writestr('word/document.xml', document)
    return buffer.getvalue()


def export_version(db, profile, version_id, format):
    """Return (bytes, MIME type, safe filename); never use client-supplied paths."""
    row = _version(db, profile, version_id)
    if format == 'txt':
        content, mime = row[4].encode('utf-8'), 'text/plain; charset=utf-8'
    elif format == 'docx':
        content, mime = _docx(row[4]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else:
        raise ValueError('Supported export formats: txt, docx')
    return content, mime, f'cv-{profile}-v{row[2]}.{format}'
