#!/usr/bin/env bash
# Updates the installed Mac app from the latest code on GitHub:
# quit app → back up data → git pull → build → replace /Applications copy → reopen.
# Run it from a terminal, or via the app's UPDATE button.
# If anything fails, the installed app is left as it was and reopened.

# Everything runs inside main(), so bash has read the whole file before
# `git pull` can change it.
main() {
  set -Eeuo pipefail

  local repo app_name app data backups log
  repo="$(cd "$(dirname "$0")/.." && pwd)"
  app_name="Rhythm Trainer"
  app="/Applications/$app_name.app"
  data="$HOME/Library/Application Support/$app_name"
  backups="$HOME/Library/Application Support/$app_name Backups"
  log="$HOME/Library/Logs/$app_name/update.log"
  mkdir -p "$(dirname "$log")"
  # Keep the previous run's log too (a failed run is usually followed by a successful retry).
  [ -f "$log" ] && mv "$log" "${log%.log}.prev.log"
  exec > >(tee "$log") 2>&1
  echo "== Update started $(date)"

  # Apps opened from Finder get a minimal PATH; find node/npm/git.
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  # shellcheck disable=SC1091
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

  trap 'fail' ERR

  # 1. Quit the app and wait for it to close.
  osascript -e "quit app \"$app_name\"" 2>/dev/null || true
  for _ in $(seq 1 50); do pgrep -xq "$app_name" || break; sleep 0.2; done

  # 2. Back up data (keep the 10 most recent).
  if [ -d "$data" ]; then
    mkdir -p "$backups"
    cp -R "$data" "$backups/$(date +%Y%m%d-%H%M%S)"
    local all=("$backups"/*/) # timestamp names sort oldest first
    if [ "${#all[@]}" -gt 10 ]; then
      for old in "${all[@]:0:${#all[@]}-10}"; do rm -rf "$old"; done
    fi
    echo "Backed up data to $backups"
  fi

  # 3–4. Latest code, then build just this Mac's architecture as a plain .app (no .dmg needed).
  cd "$repo"
  git pull --ff-only
  local arch out
  arch=$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)
  out="release/$([ "$arch" = arm64 ] && echo mac-arm64 || echo mac)"

  # npm and electron-builder sometimes fail with ENOTEMPTY when macOS (Spotlight,
  # Finder) is still holding files from the last run; a second try works, so
  # each step gets one retry after clearing what it was replacing.
  npm install --no-audit --no-fund \
    || { echo "-- npm install failed, retrying"; sleep 3; npm install --no-audit --no-fund; }
  npm run build
  local builder=(npx electron-builder --mac dir "--$arch" -c.extraMetadata.repoPath="$repo")
  rm -rf "$out" || { sleep 3; rm -rf "$out"; }
  "${builder[@]}" \
    || { echo "-- app build failed, retrying"; sleep 3; rm -rf "$out"; "${builder[@]}"; }

  local built="$out/$app_name.app"
  [ -d "$built" ] || { echo "Built app not found at $built"; false; }

  # 5. Replace the installed app only now that the new one exists.
  # Copy next to it first, so a failed delete can't leave a half-installed app.
  rm -rf "$app.new"
  ditto "$built" "$app.new"
  rm -rf "$app" || { sleep 3; rm -rf "$app"; }
  mv "$app.new" "$app"
  echo "Installed $(git rev-parse --short HEAD)"

  # 6. Reopen.
  open "$app"
  echo "== Update finished $(date)"
}

fail() {
  echo "== Update FAILED $(date)"
  osascript -e 'display notification "See ~/Library/Logs/Rhythm Trainer/update.log" with title "Rhythm Trainer update failed"' || true
  open "/Applications/Rhythm Trainer.app" 2>/dev/null || true
  exit 1
}

main "$@"
