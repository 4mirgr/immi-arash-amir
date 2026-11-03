"""One collection pass. No daemon or automatic external querying is implied."""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server.app import connect
from server.opportunities import init_schema, registry, collect_source

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',help='Collect one registered source ID; otherwise all configured feeds')
    args=parser.parse_args()
    sources=registry()
    if args.source:
        sources=[s for s in sources if s['id']==args.source]
        if not sources:parser.error('Unknown registered source')
    db=connect();init_schema(db)
    try:
        print(json.dumps([collect_source(db,s) for s in sources],indent=2))
    finally:db.close()
if __name__=='__main__':main()
