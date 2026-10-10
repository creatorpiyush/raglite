# Security policy

## Supported versions

Security fixes go into the latest minor release of the current major version (2.x).

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and the version you tested. You should get a reply within 7 days. Once a fix is released, the advisory is published with credit to you unless you prefer otherwise.

## Things to know when deploying

- `raglite serve` listens on `127.0.0.1` by default. If you expose it beyond localhost, set a bearer token (`--token` or `bearerToken`).
- Indexed documents and their chunks are stored unencrypted under `storeDir` (default `.raglite`). Treat that directory like the source documents.
- API keys passed on the command line can end up in shell history; prefer environment variables.
