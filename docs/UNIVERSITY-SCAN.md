# Official university technical discovery scan

`scripts/scan_university_sites.py` reads the server-reviewed university directory and records a bounded technical fetch of each official homepage. It does **not** generate an opportunity, verify a deadline, read every page, submit an application or infer personal eligibility.

```sh
python scripts/scan_university_sites.py --input cloud/italian-universities.json --output /workspace/scratch/italian-university-scan.json --workers 4
```

Output must be outside this Git repository. The JSON envelope is `masir-university-site-scan` version1, with `results`. Each record has `institutionId`, `checkedAt`, `status`, `title`, `finalUrl`, `links:[{url,label}]` and `limitations`. Only `status: checked` proves that a homepage body was retrieved and parsed; failures remain separate and carry canonical reason codes. It is not proof of a complete scientific or scholarship review.

The standard-library scanner verifies TLS, carries no cookies or authorization, accepts HTTPS only, rejects IP/local/internal names, ports and credentials, and follows at most two redirects within the directory-provided official base domain and its subdomains. HTTP directory URLs are rejected rather than silently upgraded. Robots is read first, with a64KB limit. A denied or unavailable robots file blocks scanning;404 means no robot rules. Crawl delays up to30seconds are honored; longer delays are skipped and reported. At most four institutions run concurrently, with same-base-domain work serialized.

One homepage body per institution is bounded to1MB and a12second per-request timeout. The parser keeps its title and at most12 actually linked, relevant research/PhD/call/scholarship pages within that official domain. Links containing query parameters or obvious login/application/admin paths are excluded. Those links are **not fetched**: they are observed discovery paths, not validated active calls, complete subsite coverage or executable feed adapters.

Synthetic tests in `tests/test_university_scan.py` cover URL boundaries, observed-link selection, robot denial, delays, request limits, redirect rejection, failures and duplicate identities. Tests make no external requests. A real scan receipt and its counts must be read before claiming actual coverage.

## Optional related-page pass

```sh
python scripts/scan_university_sites.py --related-from /workspace/scratch/italy-university-scan.json --related-per-institution 2 --output /workspace/scratch/italy-related-scan.json --workers 4
```

This pass selects at most two unique, actually observed relevant links from each successfully scanned homepage. It favors explicit PhD/call/funding paths, never guesses paths, and reapplies the same robots/TLS/host/body/delay gates. It accepts only a homepage-scan receipt, preventing recursive expansion from related-page output. The resulting `scope` is `observed_official_related_pages_only`; each child receipt adds `parentInstitutionId`, `sourceUrl` (the selected requested URL), `discoveredFrom` (the parent homepage URL), and `sourceLabel`. Child IDs are the deterministic parent ID plus `-related-1` or `-related-2` in sorted selection order. At most250 related pages are permitted in one pass. Failed related-page fetches remain failures, and even successful fetches are technical observations rather than verified calls or opportunities.

## Actual related-pass receipt — 2026-11-04

The related pass was run against `/workspace/scratch/italy-university-scan.json`, which contained the earlier102-institution homepage scan. It selected127 actually observed child URLs across64 parent institutions. Actual results:119 HTML pages checked,2 homepage HTTP errors,2 robot denials and4 redirect-limit failures. The checked related pages exposed1,189 further relevant links; these are observations only and **were not fetched**. Output is `/workspace/scratch/italy-related-scan.json`. Those scratch files are disposable technical receipts, not production database state or a Git recovery requirement. Database import and UI integration are handled separately by the root agent.
