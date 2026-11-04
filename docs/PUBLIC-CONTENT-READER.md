# Actual reading of discovered public pages

`scripts/read_discovered_pages.py` reads a finite, provenance-preserving corpus. It does not treat a URL, a successful homepage scan or an extracted link as content already read. The first dated input corpus deduplicates to **988 valid official URLs** from the102institution directory and both prior observed-link receipts. Invalid/foreign/private URLs are excluded by the reader's gates; earlier catalogue failure receipts remain separate evidence and are not changed to successful reads.

## What it does

- Combines canonical institution homepages and every valid URL observed in the supplied homepage and related-page scan files. It preserves all institution references when the same URL was observed more than once.
- Does not recursively add new pages found during reading. This makes the requested discovered corpus finite and auditable rather than an unlimited crawl of an entire website.
- Verifies TLS, confines redirects to the registered official base/subdomains, rejects IP/local/credential/port destinations and private/action paths, checks robots and honors crawl delay up to30seconds. A larger delay or unavailable policy is a visible failure, not a bypass.
- Uses no cookie jar, account, browser session, applicant form, API key, CV or private correspondence.
- Reads public HTML visible body text, TXT/CSV, and PDF through an installed `pdftotext` binary. HTML head/script/style/navigation/footer/header/aside/forms/hidden elements are excluded. Authenticated, hidden and dynamically rendered content is not implicitly read.
- Bounds response bodies to3MiB, requests to10seconds, extracted text to50,000characters and concurrency to four workers. Requests sharing an official base are serialized and robot policies cached per origin.
- PDF extraction is limited to the first50pages and is always labeled **`read_partial`**, even if the small document might contain fewer pages. Truncated HTML is also `read_partial`. Neither is represented as a complete content evaluation.
- Does not itself decide personal eligibility, create job offers, infer funding, send mail or modify a CV. The content evaluator must retain source excerpts, uncertainty and page status.

## Records and completion

Each JSONL row contains stable URL-hash `id`, requested `url`, `institutionIds`, UTC `readAt`, `status`, MIME type, title, extracted text, finalURL, source labels/provenance and limits. New executions additionally include country/profileScope and any explicit opportunity references. Old Italy-only outputs can safely be scoped IT/Amir using their recorded source queue; absence of those new fields is not evidence of an AU/private profile.

`read` means bounded public visible text was obtained. `read_partial` means the complete source was not extracted/evaluated. Canonical statuses such as `robots_blocked`, `robots_unavailable`, `access_denied`, `http_error`, `body_too_large`, `foreign_host`, `empty_text`, `pdf_parser_unavailable` or `unsupported_content` are failures or limits and contain no successful body claim. JSON/RSS feeds requiring a configured field allowlist remain the responsibility of their verified source adapter; this generic reader does not dump an arbitrary JSON payload or hidden recruitment fields.

Output is appended and flushed after every record to a JSONL artifact **outside Git**. Resume skips completed stable IDs. A single writer owns the output via nonblocking POSIX file locking in the current version; do not run an old unlocked version against the same file. To repair an interrupted partial last line, preserve the original and repair a copy before resuming; malformed records are not silently discarded. A file can contain duplicate IDs from historical concurrent runs; downstream import must deduplicate by ID and prefer successfully read/complete evidence over a later failed receipt. Counts must use unique IDs, not raw line count.

## Commands

```bash
python scripts/read_discovered_pages.py \
  --home /workspace/scratch/italy-university-scan.json \
  --related /workspace/scratch/italy-related-scan.json \
  --output /workspace/scratch/public-page-content.jsonl \
  --workers 4
```

Use `--max-pages N` for a bounded batch, then rerun the same command/output to resume. `--queue-output /path/public-queue.json --queue-only` produces the finite queue without reading pages. The queue can be copied into a durable, owner-scoped public extraction queue by the operator; writing this JSON file alone is not a background service.

Additional explicitly authorized public pages can be supplied using `--queue /path/extra-public-pages.json`. Each entry requires `{url,country:'AU'|'IT',officialBase:<publisher hostname or HTTPS origin>,institutionIds:[]}`; optional labels, discoveredFrom and opportunityIds preserve provenance. IDs supplied by callers do not override URL-hash IDs. Italy stays Amir-only; AU public source records are shared, with private profile analysis handled separately. Same-URL country changes are rejected.

```bash
python scripts/read_discovered_pages.py \
  --extra-only --queue /workspace/scratch/extra-public-pages.json \
  --output /workspace/scratch/extra-page-content.jsonl --workers 4
```

Do not concurrently append to an output currently being read. Separate extra output files are safe only when their source hosts are not being concurrently hammered; the operator should serialize host-overlapping batches. No future unattended schedule is claimed merely because this CLI exists.

## Verification

`python -m unittest discover -s tests -p test_read_discovered_pages.py -v` runs seven synthetic tests covering corpus deduplication/scope, visible-text extraction, robot/redirect gates, partial readings, unavailable PDF parser, explicit AU/IT extra queues and JSONL resume. Synthetic tests are not proof that every external source was read; actual unique-record receipts and stored evaluator results are required.
