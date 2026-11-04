import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sync_public_page_corpus', ROOT / 'scripts/sync_public_page_corpus.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicCorpusSyncTests(unittest.TestCase):
    def write_queue(self, folder, name, records):
        path = folder / name
        path.write_text(json.dumps({'records': records}), encoding='utf-8')
        return path

    def write_readings(self, folder, name, records):
        path = folder / name
        path.write_text('\n'.join(json.dumps(row) for row in records) + '\n', encoding='utf-8')
        return path

    def test_duplicate_queue_identity_merges_provenance_once_without_crossing_scope(self):
        row = {'id': 'page-a', 'url': 'https://university.example.invalid/research/', 'country': 'IT', 'institutionIds': ['uni-b'], 'officialBases': ['university.example.invalid'], 'labels': ['Research'], 'discoveredFrom': ['https://university.example.invalid/'], 'opportunityIds': ['opp-a']}
        other = {**row, 'institutionIds': ['uni-a', 'uni-b'], 'labels': ['Scholarships', 'Research'], 'opportunityIds': ['opp-b', 'opp-a']}
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            first = self.write_queue(folder, 'first.json', [row, row])
            second = self.write_queue(folder, 'second.json', [other])
            merged = module.merge_queues([first, second])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['country'], 'IT')
        self.assertEqual(merged[0]['institutionIds'], ['uni-a', 'uni-b'])
        self.assertEqual(merged[0]['labels'], ['Research', 'Scholarships'])
        self.assertEqual(merged[0]['opportunityIds'], ['opp-a', 'opp-b'])

    def test_identity_url_or_country_collision_fails_before_import(self):
        row = {'id': 'page-a', 'url': 'https://university.example.invalid/', 'country': 'IT'}
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            good = self.write_queue(folder, 'good.json', [row])
            for name, invalid in [('url.json', {**row, 'url': 'https://other.example.invalid/'}), ('country.json', {**row, 'country': 'AU'}), ('missing.json', {**row, 'country': None})]:
                with self.subTest(name=name):
                    bad = self.write_queue(folder, name, [invalid])
                    with self.assertRaises(ValueError):
                        module.merge_queues([good, bad])

    def test_complete_read_beats_newer_partial_and_failure_and_tie_uses_latest_time(self):
        def record(status, date, text):
            return {'id': 'page-a', 'status': status, 'readAt': date, 'text': text}
        rows = [record('read', '2026-11-04T01:00:00Z', 'Complete older text'), record('robots_blocked', '2026-11-04T04:00:00Z', ''), record('read_partial', '2026-11-04T03:00:00Z', 'Partial newer text')]
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            first = self.write_readings(folder, 'first.jsonl', rows)
            selected = module.best_readings([first], {'page-a'})
            self.assertEqual(selected[0]['text'], 'Complete older text')
            second = self.write_readings(folder, 'second.jsonl', [record('read', '2026-11-04T02:00:00Z', 'Complete latest text'), record('read', '2026-11-04T00:00:00Z', 'Complete earliest text')])
            selected = module.best_readings([first, second, first], {'page-a'})
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]['text'], 'Complete latest text')

    def test_partial_beats_failure_and_readings_outside_explicit_queue_are_ignored(self):
        rows = [{'id': 'page-a', 'status': 'read_partial', 'readAt': '2026-11-04T01:00:00Z', 'text': 'Partial source text'}, {'id': 'page-a', 'status': 'fetch_failed', 'readAt': '2026-11-04T04:00:00Z', 'text': ''}, {'id': 'not-in-queue', 'status': 'read', 'readAt': '2026-11-04T05:00:00Z', 'text': 'Unregistered content'}]
        with tempfile.TemporaryDirectory() as temp:
            path = self.write_readings(Path(temp), 'readings.jsonl', rows)
            selected = module.best_readings([path], {'page-a'})
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]['status'], 'read_partial')
        self.assertEqual(selected[0]['text'], 'Partial source text')


if __name__ == '__main__':
    unittest.main()
