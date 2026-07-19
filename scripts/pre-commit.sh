#!/bin/bash
set -e

echo "=== Running Pre-Commit Checks ==="

echo "1. Checking code style and linting..."
npx biome check .

echo "2. Running typechecks..."
npm run typecheck

echo "3. Running tests..."
npm test

echo "=== All checks passed! Ready to commit ==="
