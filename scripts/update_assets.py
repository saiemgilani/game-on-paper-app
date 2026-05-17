# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "pydo",
#     "boto3",
#     "tqdm"
# ]
# ///

# https://docs.digitalocean.com/products/spaces/how-to/use-aws-sdks/#install-python-3
import os
import boto3
from pathlib import Path
from tqdm import tqdm
from datetime import datetime

async def upload_assets(creds: dict[str, str] = {}, ttl: int = (60 * 60 * 24 * 7), dry_run: bool = True):
    _, _, files = os.walk(Path.cwd() / "node" / "public" / "assets")
    files = [f for f in files if ".DS_Store" not in f]

    session = boto3.session.Session()
    client = session.client(
        's3',
        region_name='nyc3',
        endpoint_url='https://nyc3.digitaloceanspaces.com',
        aws_access_key_id=creds.get('DIGITAL_OCEAN_SPACES_KEY'),
        aws_secret_access_key=creds.get('DIGITAL_OCEAN_SPACES_SECRET'),
    )

    for n in tqdm(files):
        try:
            with open(n, "r") as f:
                if dry_run:
                    print(f"[{datetime.now()}] Dry run for upload of {n}: {f[0:100]}")
                else:
                    print(f"[{datetime.now()}] Uploading {n}: {f[0:100]}")
                    client.put_object(
                        Bucket=creds.get("DIGITAL_OCEAN_SPACES_BUCKET_NAME"),
                        Key=n,
                        Body=f.read(),
                        Metadata={
                            "UploadedBy": "python-script",
                            "Cache-Control": ttl,
                        },
                        ContentDisposition="inline",
                    )
        except Exception as e:
            print("[%s] ERROR while uploading file %s to CDN: %r (%s)" % (datetime.now(), n, e, e))

    print(f"[{datetime.now()}] Assets uploaded.")


if __name__ == "__main__":
    dry_run = os.getenv("CDN_DRY_RUN", "true") == "true"
    cdn_ttl = int(os.getenv("CDN_TTL", "608400"))
    creds = {
        k: os.getenv(k)
        for k in ["DIGITAL_OCEAN_SPACES_KEY", "DIGITAL_OCEAN_SPACES_SECRET", "DIGITAL_OCEAN_SPACES_BUCKET_NAME"]
    }
    upload_assets(
        creds=creds,
        ttl=cdn_ttl,
        dry_run=dry_run
    )