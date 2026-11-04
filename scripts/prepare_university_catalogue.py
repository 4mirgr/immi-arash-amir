"""Generate reviewable PUBLIC D1 import SQL; never connects or uses credentials."""
import argparse
import json
from pathlib import Path


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("'", "''") + "'"


def prepare(directory, home=None, related=None):
    if not isinstance(directory, list) or not 1 <= len(directory) <= 250:
        raise ValueError("Invalid directory")
    ids = {r["id"] for r in directory}
    if len(ids) != len(directory) or any(r.get("country") != "IT" or r.get("profileScope") != "amir" for r in directory):
        raise ValueError("Invalid directory scope or duplicate identity")
    sql = ["INSERT INTO university_catalogue(id,country,profile_scope,name,url,data,directory_checked_at) SELECT json_extract(value,'$.id'),'IT','amir',json_extract(value,'$.name'),json_extract(value,'$.url'),value,json_extract(value,'$.reviewedAt') FROM json_each(" + literal(directory) + ") WHERE 1 ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,data=excluded.data,directory_checked_at=excluded.directory_checked_at;"]
    if home is not None:
        rows = home.get("results")
        if not isinstance(rows, list) or len(rows) > 250 or any(r.get("institutionId") not in ids for r in rows):
            raise ValueError("Invalid homepage receipt")
        sql.append("INSERT INTO university_catalogue(id,country,profile_scope,name,url,data,directory_checked_at,scan_status,scan_checked_at,scan_data) SELECT u.id,u.country,u.profile_scope,u.name,u.url,u.data,u.directory_checked_at,json_extract(s.value,'$.status'),json_extract(s.value,'$.checkedAt'),s.value FROM json_each(" + literal(rows) + ") s JOIN university_catalogue u ON json_extract(s.value,'$.institutionId')=u.id WHERE 1 ON CONFLICT(id) DO UPDATE SET scan_status=excluded.scan_status,scan_checked_at=excluded.scan_checked_at,scan_data=excluded.scan_data;")
    if related is not None:
        rows = related.get("results")
        if not isinstance(rows, list) or len(rows) > 500 or any(r.get("parentInstitutionId") not in ids for r in rows):
            raise ValueError("Invalid related receipt")
        sql.append("INSERT INTO university_related_checks(id,institution_id,url,status,checked_at,data) SELECT json_extract(value,'$.institutionId'),json_extract(value,'$.parentInstitutionId'),json_extract(value,'$.sourceUrl'),json_extract(value,'$.status'),json_extract(value,'$.checkedAt'),value FROM json_each(" + literal(rows) + ") WHERE 1 ON CONFLICT(id) DO UPDATE SET url=excluded.url,status=excluded.status,checked_at=excluded.checked_at,data=excluded.data;")
    return "\n".join(sql) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="cloud/italian-universities.json")
    parser.add_argument("--home")
    parser.add_argument("--related")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    read = lambda path: json.loads(Path(path).read_text(encoding="utf-8")) if path else None
    sql = prepare(read(args.directory), read(args.home), read(args.related))
    with Path(args.output).open("x", encoding="utf-8") as target:
        target.write(sql)
    print("Public catalogue SQL prepared; no database or network accessed.")


if __name__ == "__main__":
    main()
