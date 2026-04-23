# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "pydo"
# ]
# ///

# https://docs.digitalocean.com/reference/pydo/reference/cdn/purge_cache/

import os
import sys
from pydo import Client
from datetime import datetime


async def purge_cdn(cdn_endpoint_id: str = os.getenv("DIGITAL_OCEAN_CDN_ENDPOINT_ID"), paths: list[str] = ["assets/*"], token: str = os.getenv("DIGITAL_OCEAN_TOKEN")):
    try:
        print(f"[{datetime.now()}] Authing to CDN (id {cdn_endpoint_id}).")
        client = Client(token=token)
        print(f"[{datetime.now()}] Purging paths {paths} from CDN (id {cdn_endpoint_id}).")
        client.cdn.purge_cache(cdn_endpoint_id, {"files": paths})
        print(f"[{datetime.now()}] All files at paths {paths} purged from CDN (id {cdn_endpoint_id}).")
    except Exception as e:
        print("[%s] ERROR while purging CDN files at paths %s: %r (%s)" % (datetime.now(), paths, e, e))



if __name__ == "__main__":
    path_glob = sys.argv[1:] if len(sys.argv) > 0 else "assets/*"
    target_paths = [path_glob]

    purge_cdn(
        creds = os.getenv("DIGITAL_OCEAN_CDN_ENDPOINT_ID"),
        paths=target_paths,
        token=os.getenv("DIGITAL_OCEAN_TOKEN")
    )