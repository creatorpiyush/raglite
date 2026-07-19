#!/bin/bash
set -e

echo "=== Running Pre-Release Checklist & Build ==="

echo "1. Cleaning previous builds..."
npm run clean

echo "2. Checking code style and linting..."
npx biome check .

echo "3. Running typecheck..."
npm run typecheck

echo "4. Running full test suite..."
npm test

echo "5. Building dist packages..."
npm run build

echo "=== Build succeeded! ==="
echo "Checklist before publishing:"
echo " [ ] Incremented version in package.json?"
echo " [ ] Documented changes in CHANGELOG / Release Notes?"
echo " [ ] Verified documentation is up to date?"
echo "Ready to publish: npm publish"
