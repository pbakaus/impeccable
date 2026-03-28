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
  find "$REPO_DIR" -maxdepth 1 -type d -name ".*" ! -name ".git" ! -name ".github" ! -name ".*-plugin" -exec basename {} \; | sed 's/^\.//' | sort
  exit 1
fi

PROVIDER_DIR=".$PROVIDER"
SOURCE_SKILLS_DIR="$REPO_DIR/$PROVIDER_DIR/skills"
TARGET_PROVIDER_DIR="$PARENT_DIR/$PROVIDER_DIR"
TARGET_SKILLS_DIR="$TARGET_PROVIDER_DIR/skills"

if [ ! -d "$REPO_DIR/$PROVIDER_DIR" ]; then
  echo "Error: Provider directory '$PROVIDER_DIR' not found in $REPO_DIR"
  exit 1
fi

if [ ! -d "$SOURCE_SKILLS_DIR" ]; then
  echo "Error: Skills directory '$SOURCE_SKILLS_DIR' not found"
  exit 1
fi

echo "Linking skill folders from $PROVIDER_DIR into parent directory..."

mkdir -p "$TARGET_SKILLS_DIR"

LINKED=0
SKIPPED=0

for skill_dir in "$SOURCE_SKILLS_DIR"/*; do
  [ -d "$skill_dir" ] || continue

  skill_name="$(basename "$skill_dir")"
  target_path="$TARGET_SKILLS_DIR/$skill_name"
  relative_source="$SUBMODULE_NAME/$PROVIDER_DIR/skills/$skill_name"

  if [ -e "$target_path" ] || [ -L "$target_path" ]; then
    echo "Warning: '$target_path' already exists. Skipping $skill_name."
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  (
    cd "$PARENT_DIR"
    ln -s "$relative_source" "$PROVIDER_DIR/skills/$skill_name"
  )

  echo "Linked: $target_path -> $relative_source"
  LINKED=$((LINKED + 1))
done

echo "Done! Linked $LINKED skill folder(s), skipped $SKIPPED existing folder(s)."
