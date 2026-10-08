"""Reference presigned-GET signature from botocore (independent of our signer).
usage: presign-ref.py <access> <secret> <region> <url> <expires> <YYYYMMDDTHHMMSSZ>
prints the full presigned URL."""
import datetime
import sys
from unittest import mock

from botocore.auth import S3SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

access, secret, region, url, expires, amz = sys.argv[1:7]
frozen = datetime.datetime.strptime(amz, "%Y%m%dT%H%M%SZ")


class _DT(datetime.datetime):
    @classmethod
    def utcnow(cls):
        return frozen


import botocore.auth as _bauth

# Newer botocore reads the clock through get_current_datetime(); older releases call datetime.utcnow().
# Freeze both so the reference uses exactly the timestamp our signer used (otherwise the comparison
# is only equal when both happen inside the same wall-clock second).
_patches = [mock.patch("botocore.auth.datetime.datetime", _DT)]
if hasattr(_bauth, "get_current_datetime"):
    _patches.append(mock.patch("botocore.auth.get_current_datetime", lambda *a, **k: frozen.replace(tzinfo=datetime.timezone.utc)))
for _p in _patches:
    _p.start()
if True:
    auth = S3SigV4QueryAuth(Credentials(access, secret), "s3", region, expires=int(expires))
    req = AWSRequest(method="GET", url=url)
    req.context = {}
    auth.add_auth(req)
print(req.url)
