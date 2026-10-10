# Contributing to RAGLite

Thanks for helping. Bug reports, docs fixes and pull requests are all welcome.

RAGLite has two SDKs that must behave the same: this TypeScript package and [raglite-py](https://github.com/creatorpiyush/raglite-py). If your change affects chunking, tokenizing, scoring, citations or anything stored in an index, it needs a matching change in the other SDK (see [Cross-SDK fixtures](#cross-sdk-fixtures)). Open an issue first if you are unsure.

## Set up

Requires Node.js 20 or later.

```bash
git clone https://github.com/creatorpiyush/raglite.git
cd raglite
npm install
npm run verify      # typecheck, lint and tests
```

## Make a change

1. Branch from `main` with a descriptive name, such as `fix/pdf-page-numbers` or `feat/pgvector-store`.
2. Add or update tests next to the code you change (`tests/unit`, `tests/integration`). Tests must not call real provider APIs; use the mocks in `tests/helpers`.
3. Run `bash scripts/pre-commit.sh` (lint, typecheck, tests).
4. Add an entry under a dated version heading in `CHANGELOG.md`, and update `README.md` if users will notice the change.
5. Open a pull request and fill in the template.

### Dependencies

Provider SDKs are optional peer dependencies, loaded with `import()` on first use. A new provider or store should follow the same pattern: add the package to `peerDependencies` (optional) and `devDependencies`, and load it with `missingPackage()` from `src/errors.ts` so users get a clear install message.

After changing dependencies, regenerate the lockfile with npm 10, or `npm ci` fails on Node 20 and 22:

```bash
npx -p npm@10 npm install
```

## Cross-SDK fixtures

`tests/fixtures/shared/*.json` pin the outputs both SDKs must produce. If you change behaviour on purpose:

```bash
npx tsx scripts/generate-shared-fixtures.ts
npx biome check --write tests/fixtures
```

Then copy them to raglite-py with `python scripts/sync_shared_fixtures.py --source ../raglite` and make its tests pass too.

## Live provider check

`npm run smoke:providers` calls each provider whose API key is set in your environment. It costs a few cents and is not part of CI; run it when you touch provider code or default models.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
