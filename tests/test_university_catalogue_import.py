import importlib.util
import sqlite3
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("catalogue_import", root / "scripts/prepare_university_catalogue.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CatalogueImportTests(unittest.TestCase):
    def test_quoted_public_data_and_related_receipts_roundtrip_without_vacancies(self):
        db = sqlite3.connect(":memory:")
        db.executescript((root / "cloud/university-catalogue-schema.sql").read_text())
        directory = [{"id": "uni-1", "name": "University O'Example", "url": "https://example.invalid/", "country": "IT", "profileScope": "amir", "reviewedAt": "2026-11-04"}]
        home = {"results": [{"institutionId": "uni-1", "status": "checked", "checkedAt": "2026-11-04T00:00:00Z", "links": []}]}
        related = {"results": [{"institutionId": "uni-1-related-1", "parentInstitutionId": "uni-1", "sourceUrl": "https://example.invalid/research/", "status": "robots_blocked", "checkedAt": "2026-11-04T00:00:00Z"}]}
        sql = module.prepare(directory, home, related)
        db.executescript(sql)
        db.executescript(sql)
        self.assertEqual(db.execute("select name,scan_status from university_catalogue").fetchone(), ("University O'Example", "checked"))
        self.assertEqual(db.execute("select count(*) from university_related_checks").fetchone()[0], 1)
        self.assertFalse(db.execute("select name from sqlite_master where name='opportunity_editions'").fetchall())

    def test_invalid_scope_or_foreign_parent_is_rejected_before_generating_sql(self):
        row = {"id": "uni-1", "country": "IT", "profileScope": "amir"}
        for rows in ([row, row], [{**row, "profileScope": "both"}]):
            with self.assertRaises(ValueError):
                module.prepare(rows)
        with self.assertRaises(ValueError):
            module.prepare([row], related={"results": [{"parentInstitutionId": "other"}]})


if __name__ == "__main__":
    unittest.main()
