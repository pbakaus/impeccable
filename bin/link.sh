#!/bin/bash

# link.sh: Symlink impeccable skills into the parent project directory
# Usage: ./bin/link.sh <provider>

set -e

PROVIDER=$1
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMODULE_NAME="$(basename "$REPO_DIR")"
PARENT_DIR="$(cd "$REPO_DIR/.." && pwd)"

if [ -z "$PROVIDER" ]; then
  echo "Usage: $0 <provider>"
  echo "Example: $0 cursor"
  echo "Available providers:"
  ls -d "$REPO_DIR"/.* | grep -E '\.(cursor|claude|gemini|openai|windsurf)$' | xargs -n1 basename
  exit 1
fi

PROVIDER_DIR=".$PROVIDER"

if [ ! -d "$REPO_DIR/$PROVIDER_DIR" ]; then
  echo "Error: Provider directory '$PROVIDER_DIR' not found in $REPO_DIR"
  exit 1
fi

echo "Linking .$PROVIDER to parent directory..."

# Check if target already exists in parent
if [ -e "$PARENT_DIR/$PROVIDER_DIR" ]; then
  echo "Warning: '$PARENT_DIR/$PROVIDER_DIR' already exists. Skipping."
else
  # Create relative symlink
  ln -s "$SUBMODULE_NAME/$PROVIDER_DIR" "$PARENT_DIR/$PROVIDER_DIR"
  echo "Done! Created symlink: $PARENT_DIR/$PROVIDER_DIR -> $SUBMODULE_NAME/$PROVIDER_DIR"
fi
