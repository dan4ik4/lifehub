"""Generate independent VAPID keys in a chosen env file; never print secrets."""

import argparse
import base64
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, PublicFormat, NoEncryption
from dotenv import dotenv_values, set_key


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default=".env")
    args = parser.parse_args()
    path = Path(args.env_file)
    if not path.is_file():
        raise SystemExit("Environment file not found")
    values = dotenv_values(path)
    if values.get("LIFEHUB_WEBPUSH_PRIVATE_KEY") or values.get("LIFEHUB_WEBPUSH_PUBLIC_KEY"):
        raise SystemExit("Existing VAPID configuration preserved")
    key = ec.generate_private_key(ec.SECP256R1())
    private = (
        base64.urlsafe_b64encode(key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption()))
        .decode()
        .rstrip("=")
    )
    public = (
        base64.urlsafe_b64encode(key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint))
        .decode()
        .rstrip("=")
    )
    set_key(path, "LIFEHUB_WEBPUSH_PRIVATE_KEY", private, quote_mode="never")
    set_key(path, "LIFEHUB_WEBPUSH_PUBLIC_KEY", public, quote_mode="never")
    set_key(
        path,
        "LIFEHUB_WEBPUSH_SUBJECT",
        values.get("LIFEHUB_WEBPUSH_SUBJECT") or "https://lifehapp.online",
        quote_mode="never",
    )
    print("Web Push configuration generated; no secrets displayed")


if __name__ == "__main__":
    main()
