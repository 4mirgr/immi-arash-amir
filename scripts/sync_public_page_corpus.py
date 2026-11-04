"""Import public queues/read receipts through a temporary authorized operator.

No provider grants or private documents are read. Keep credentials and corpus
artifacts outside Git; the operator must accept only bounded public batches.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def merge_queues(paths):
    rows = {}
    for path in paths:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        for row in value["records"]:
            if row.get("country") not in ("IT", "AU"):
                raise ValueError("Explicit country scope required")
            current = rows.setdefault(row["id"], dict(row))
            if current["url"] != row["url"] or current["country"] != row["country"]:
                raise ValueError("Public identity/scope collision")
            for key in ("institutionIds", "officialBases", "labels", "discoveredFrom", "opportunityIds"):
                current[key] = sorted(set(current.get(key, []) + row.get(key, [])))
    return list(rows.values())


def best_readings(paths, ids):
    rows = {}
    rank = lambda r: 3 if r.get("status") == "read" else 2 if r.get("status") == "read_partial" else 1
    for path in paths:
        with Path(path).open(encoding="utf-8") as source:
            for line in source:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row["id"] not in ids:
                    continue
                old = rows.get(row["id"])
                if old is None or (rank(row), row.get("readAt", "")) > (rank(old), old.get("readAt", "")):
                    rows[row["id"]] = row
    return list(rows.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", action="append", required=True)
    parser.add_argument("--readings", action="append", default=[])
    parser.add_argument("--operator-url", required=True)
    parser.add_argument("--header-file", required=True)
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    endpoint = urlsplit(args.operator_url)
    if endpoint.scheme != "https" or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        parser.error("HTTPS operator URL required")
    header = Path(args.header_file).read_text().strip()
    name, _, secret = header.partition(":")
    if name.lower() != "authorization" or not secret.strip().startswith("Bearer "):
        parser.error("Bearer header file required")
    def post(path, payload):
        # curl uses the authorized header file without putting its secret in argv.
        # No redirect following or TLS bypass is enabled.
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json") as body:
            json.dump(payload, body, ensure_ascii=False)
            body.flush()
            result = subprocess.run(["curl", "--silent", "--show-error", "--fail-with-body", "--proto", "=https", "--max-time", "30", "-X", "POST", "-H", "@" + args.header_file, "-H", "Content-Type: application/json", "--data-binary", "@" + body.name, args.operator_url.rstrip("/") + path], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("Public corpus operator request failed; inspect status without logging the credential or page body")
        return json.loads(result.stdout)
    queue = merge_queues(args.queue)
    for start in range(0, len(queue), 100):
        post("/seed", {"rows": queue[start:start+100]})
    print(json.dumps({"seededUnique": len(queue)}), flush=True)
    readings = best_readings(args.readings, {r["id"] for r in queue})
    with ThreadPoolExecutor(max_workers=max(1, min(3, args.workers))) as executor:
        futures = [executor.submit(post, "/readings", {"records": readings[start:start+2]}) for start in range(0, len(readings), 2)]
        for index, future in enumerate(as_completed(futures), 1):
            future.result()
            if index % 50 == 0:
                print(json.dumps({"importedBatches": index, "totalBatches": len(futures)}), flush=True)
    print(json.dumps({"seededUnique": len(queue), "importedUniqueReadings": len(readings), "privateData": False}), flush=True)


if __name__ == "__main__":
    main()
