"""Creates an IAM user with S3 access plus a bucket on a local moto server and prints
"<access key id> <secret>" for the S3 provider tests.

The server must be started with INITIAL_NO_AUTH_ACTION_COUNT=3, so that everything after
these three IAM calls is signature-verified by botocore's SigV4 implementation - an
independent check of our hand-written signer."""
import json
import sys

import boto3

port = sys.argv[1]
bucket = sys.argv[2]
ep = f"http://127.0.0.1:{port}"
iam = boto3.client("iam", endpoint_url=ep, region_name="us-east-1", aws_access_key_id="x", aws_secret_access_key="y")
iam.create_user(UserName="rz-test")
iam.put_user_policy(
    UserName="rz-test",
    PolicyName="s3all",
    PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "s3:*", "Resource": "*"}]}),
)
key = iam.create_access_key(UserName="rz-test")["AccessKey"]
boto3.client(
    "s3",
    endpoint_url=ep,
    region_name="us-east-1",
    aws_access_key_id=key["AccessKeyId"],
    aws_secret_access_key=key["SecretAccessKey"],
).create_bucket(Bucket=bucket)
print(key["AccessKeyId"], key["SecretAccessKey"])
