"""Print VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY lines for .env (web push signing keys)."""
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


v = Vapid()
v.generate_keys()
public = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
private = v.private_key.private_numbers().private_value.to_bytes(32, "big")
print(f"VAPID_PUBLIC_KEY={b64(public)}")
print(f"VAPID_PRIVATE_KEY={b64(private)}")
