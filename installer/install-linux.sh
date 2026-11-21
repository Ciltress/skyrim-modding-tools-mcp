#!/usr/bin/env bash
# Installs Skyrim Modding Tools - MCP Server on Linux, or updates it: run it again for each new version.
#
# It brings git and Node.js 24 where they are missing (asking first), fetches the newest version from GitHub
# into ~/skyrim-modding-tools-mcp (or the folder --dir names) and runs its setup, which asks for the rest.
# Your settings (.env) and your projects stay where they are.
#
#   bash install-linux.sh [--dir <folder>] [--instance <the folder with ModOrganizer.ini>]

set -euo pipefail

REPO=https://github.com/Ciltress/skyrim-modding-tools-mcp.git
BRANCH=main
NODE_MIN=24.18.0
NODE_LINE=latest-v24.x

dir="$HOME/skyrim-modding-tools-mcp"
setup_args=()
while (($#)); do
    case $1 in
        --dir) dir=${2:?--dir needs a folder}; shift 2 ;;
        --instance) setup_args+=(--instance "${2:?--instance needs a folder}"); shift 2 ;;
        -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
done

# Started from a file manager ("Run", "Execute"), there is no terminal to ask in or to read: open one.
if [[ ! -t 0 || ! -t 1 ]] && [[ -z ${SMT_INSTALLER_TERMINAL:-} ]] && [[ -n ${DISPLAY:-}${WAYLAND_DISPLAY:-} ]]; then
    export SMT_INSTALLER_TERMINAL=1
    self=$(readlink -f "$0")
    passed=(--dir "$dir" "${setup_args[@]}")
    for term in konsole gnome-terminal xfce4-terminal xterm; do
        command -v "$term" >/dev/null || continue
        case $term in
            gnome-terminal) exec gnome-terminal -- bash "$self" "${passed[@]}" ;;
            xfce4-terminal) exec xfce4-terminal -x bash "$self" "${passed[@]}" ;;
            *) exec "$term" -e bash "$self" "${passed[@]}" ;;
        esac
    done
fi
if [[ -n ${SMT_INSTALLER_TERMINAL:-} ]]; then
    trap 'echo; read -r -p "Press Enter to close this window." _' EXIT
fi

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
fail() { printf '\n%s\n' "$*" >&2; exit 1; }
# Yes on Enter; never yes where no one can answer.
ask() {
    [[ -t 0 ]] || return 1
    local answer
    read -r -p "$1 [Y/n] " answer
    [[ $answer =~ ^([yY]|[yY][eE][sS]|[jJ]|[jJ][aA])?$ ]]
}
has() { command -v "$1" >/dev/null 2>&1; }
# Whether version $1 is at least $2.
at_least() { [[ $(printf '%s\n' "$2" "$1" | sort -V | head -n1) == "$2" ]]; }
node_ok() { has node && at_least "$(node --version 2>/dev/null | sed 's/^v//')" "$NODE_MIN"; }

package_manager() {
    local manager
    for manager in pacman apt-get dnf zypper; do
        if has "$manager"; then printf '%s' "$manager"; return; fi
    done
}

# Installs a package with the system's package manager, after a yes.
system_install() {
    local manager
    manager=$(package_manager)
    [[ -n $manager ]] || return 1
    ask "Install $* with $manager (it asks for your password)?" || return 1
    case $manager in
        pacman) sudo pacman -S --needed --noconfirm "$@" ;;
        apt-get) sudo apt-get install -y "$@" ;;
        dnf) sudo dnf install -y "$@" ;;
        zypper) sudo zypper --non-interactive install "$@" ;;
    esac
}

# Node.js 24 from nodejs.org for this user alone, no password needed: into ~/.local/share, linked from
# ~/.local/bin. The download is checked against nodejs.org's own checksums. Each step returns on failure
# itself: set -e does not reach into a function called in a || list.
user_node() {
    local arch base sums file folder
    case $(uname -m) in
        x86_64) arch=x64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) return 1 ;;
    esac
    has curl && has tar && has sha256sum || return 1
    ask "Install Node.js 24 from nodejs.org for you alone, into ~/.local (no password needed)?" || return 1
    base="https://nodejs.org/dist/$NODE_LINE"
    sums=$(curl -fsSL "$base/SHASUMS256.txt") || return 1
    file=$(awk -v arch="$arch" '$2 ~ "^node-v[0-9.]+-linux-" arch "\\.tar\\.xz$" { print $2 }' <<<"$sums" | head -n1)
    [[ -n $file ]] || return 1
    folder="$HOME/.local/share/skyrim-modding-tools"
    mkdir -p "$folder" "$HOME/.local/bin" || return 1
    say "Downloading $file"
    curl -fL --progress-bar -o "$folder/$file" "$base/$file" || return 1
    (cd "$folder" && grep "  $file\$" <<<"$sums" | sha256sum -c --quiet -) || { rm -f "$folder/$file"; say "The download does not match nodejs.org's checksum."; return 1; }
    tar -xJf "$folder/$file" -C "$folder" || return 1
    rm -f "$folder/$file"
    ln -sfn "$folder/${file%.tar.xz}" "$folder/node" || return 1
    for program in node npm npx; do ln -sfn "$folder/node/bin/$program" "$HOME/.local/bin/$program" || return 1; done
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *) NODE_PATH_NOTE=1 ;;
    esac
    export PATH="$HOME/.local/bin:$PATH"
    hash -r
}

step "1. git and Node.js"
if has git; then
    say "git is installed."
else
    system_install git || true
    has git || fail "git is missing. Install it with your system's package manager (the package is called git), then run this again."
fi
NODE_PATH_NOTE=
if node_ok; then
    say "Node.js $(node --version) is installed."
else
    if has node; then say "Node.js $(node --version) is too old: the server needs $NODE_MIN or later."; fi
    # Arch and its kin package the newest Node.js; elsewhere a distribution's is often too old, so Node.js
    # comes from nodejs.org for this user.
    if [[ $(package_manager) == pacman ]]; then system_install nodejs npm || true; hash -r; fi
    node_ok || user_node || true
    node_ok || fail "Node.js $NODE_MIN or later is missing. Install Node.js 24 (https://nodejs.org), then run this again."
    say "Node.js $(node --version) is installed."
fi

step "2. The server"
if [[ -d $dir/.git ]]; then
    say "Updating $dir"
    cd "$dir"
    git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REPO"
    branch=$(git symbolic-ref --quiet --short HEAD || true)
    if [[ -n $branch && $branch != "$BRANCH" ]]; then
        fail "$dir is on the branch $branch, not $BRANCH: update it yourself with git."
    fi
    changed=$(git status --porcelain --untracked-files=no)
    if [[ -n $changed ]]; then
        fail "$(printf 'These files of the server were changed in %s:\n%s\nUndo the changes (git -C "%s" checkout -- .) or keep them elsewhere, then run this again.' "$dir" "$changed" "$dir")"
    fi
    git fetch --quiet origin "$BRANCH"
    if [[ -z $branch ]]; then
        git checkout --quiet "$BRANCH" 2>/dev/null || git checkout --quiet -b "$BRANCH" "origin/$BRANCH"
    fi
    git merge --quiet --ff-only "origin/$BRANCH" ||
        fail "$dir has commits of its own on $BRANCH, which the newest version does not have: update it yourself with git."
elif [[ -f $dir/package.json ]] && grep -q '"name": "skyrim-modding-tools-mcp"' "$dir/package.json"; then
    # A folder unpacked from an older download: made a clone where it is, its .env and projects kept.
    say "Making $dir a clone of the server, so it can be updated"
    cd "$dir"
    git init --quiet
    git remote add origin "$REPO" 2>/dev/null || git remote set-url origin "$REPO"
    git fetch --quiet origin "$BRANCH"
    git checkout --quiet --force -B "$BRANCH" "origin/$BRANCH"
elif [[ -e $dir && -n $(ls -A "$dir" 2>/dev/null) ]]; then
    fail "$dir is there and holds something else. Name another folder: --dir <folder>."
else
    say "Downloading the server into $dir"
    git clone --quiet --branch "$BRANCH" "$REPO" "$dir"
    cd "$dir"
fi
git branch --quiet --set-upstream-to="origin/$BRANCH" "$BRANCH" 2>/dev/null || true
say "The server is at version $(node -p "require('./package.json').version") ($(git log -1 --format='%h, %cs'))."

step "3. Setup"
npm run setup -- "${setup_args[@]}"

if [[ -n $NODE_PATH_NOTE ]]; then
    say ""
    say "Node.js is in ~/.local/bin, which is not on your PATH yet. Add it, so your MCP client finds node:"
    say "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.profile    (then log out and in again)"
fi
say ""
say "To update later, run this installer again."
