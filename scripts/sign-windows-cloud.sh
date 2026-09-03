#!/usr/bin/env bash
# Sample Windows Authenticode signing script for cloud signing services.
# Adapt this template to your specific signing provider.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <path-to-executable>" >&2
  exit 1
fi

EXECUTABLE_PATH="$1"

if [ ! -f "$EXECUTABLE_PATH" ]; then
  echo "Error: Executable not found: $EXECUTABLE_PATH" >&2
  exit 1
fi

echo "Signing: $EXECUTABLE_PATH"

# TODO: Implement your signing provider's API call here
# See docs/windows-signing.md for examples

echo "⚠️  This is a template signing script. Please configure it for your signing provider."
exit 1
