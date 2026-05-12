#!/bin/bash
# Build a macOS .pkg installer for the Vessel backend.
#
# Pipeline:
#   1. pnpm install + frontend build
#   2. pnpm deploy --filter @vessel/backend → build/payload/backend
#   3. Stage frontend dist under build/payload/frontend/dist
#   4. Download + cache Node binary, drop under build/payload/node
#   5. Rebuild native modules (better-sqlite3 etc) with the bundled Node ABI
#   6. Stage launcher + plist template + uninstall.sh
#   7. pkgbuild → dist/Vessel-Backend-v<version>-<arch>.pkg
#
# Outputs:
#   dist/Vessel-Backend-v<version>-<arch>.pkg
#
# Re-runnable: rm -rf build/ to start clean. installer/cache/ is preserved
# across runs (Node tarball, ~90 MB).

set -euo pipefail

# ────────────────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────────────────
NODE_VERSION="${NODE_VERSION:-24.12.0}"
# Target arch of the produced .pkg. Defaults to host arch — override via env
# to cross-build (e.g. on M1 host: ARCH=x64 bash scripts/build-pkg.sh).
HOST_ARCH="$(uname -m)"
case "${HOST_ARCH}" in
  arm64)  DEFAULT_ARCH="arm64" ;;
  x86_64) DEFAULT_ARCH="x64" ;;
  *)      DEFAULT_ARCH="arm64" ;;
esac
ARCH="${ARCH:-${DEFAULT_ARCH}}"

if [ "${ARCH}" != "${DEFAULT_ARCH}" ]; then
  echo "[build-pkg] WARNING: cross-build requested (host=${HOST_ARCH}, target=${ARCH})."
  echo "[build-pkg]   npm rebuild will run on the HOST arch, so native modules in"
  echo "[build-pkg]   the produced .pkg will be ${HOST_ARCH}, not ${ARCH}."
  echo "[build-pkg]   Cross-build is not supported. Build on the target Mac instead."
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/build"
PAYLOAD="${BUILD_DIR}/payload"
DIST_DIR="${REPO_ROOT}/dist"
CACHE_DIR="${REPO_ROOT}/installer/cache"

PKG_IDENT="com.vessel.backend"
# Source of truth for the .pkg version is the backend's package.json. Same
# string the backend reports via /health → cliBin caller via process.env.
VERSION="$(node -p "require('${REPO_ROOT}/packages/backend/package.json').version")"

PKG_NAME="Vessel-Backend-v${VERSION}-${ARCH}.pkg"
PKG_OUT="${DIST_DIR}/${PKG_NAME}"

NODE_DIST_FILE="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
NODE_DIST_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST_FILE}"

echo "──────────────────────────────────────────"
echo "Vessel macOS .pkg build"
echo "  version : ${VERSION}"
echo "  arch    : ${ARCH}"
echo "  node    : ${NODE_VERSION}"
echo "  output  : ${PKG_OUT}"
echo "──────────────────────────────────────────"

# ────────────────────────────────────────────────────────────────────────────
# 0. Prereq sanity
# ────────────────────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "[build-pkg] missing: $1" >&2; exit 1; }; }
need pnpm
need curl
need tar
need shasum
need pkgbuild
need rsync

# ────────────────────────────────────────────────────────────────────────────
# 1. Clean payload, keep cache
# ────────────────────────────────────────────────────────────────────────────
rm -rf "${PAYLOAD}"
mkdir -p "${PAYLOAD}" "${DIST_DIR}" "${CACHE_DIR}"

# ────────────────────────────────────────────────────────────────────────────
# 2. Install workspace + build frontend
# ────────────────────────────────────────────────────────────────────────────
echo "[build-pkg] (1/7) pnpm install"
( cd "${REPO_ROOT}" && pnpm install --frozen-lockfile )

echo "[build-pkg] (2/7) building frontend"
( cd "${REPO_ROOT}" && pnpm --filter @vessel/frontend build )

FRONTEND_DIST="${REPO_ROOT}/packages/frontend/dist"
if [ ! -f "${FRONTEND_DIST}/index.html" ]; then
  echo "[build-pkg] FATAL: frontend build did not produce ${FRONTEND_DIST}/index.html" >&2
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# 3. pnpm deploy backend
# ────────────────────────────────────────────────────────────────────────────
# `pnpm deploy` creates a stand-alone copy of the package with all workspace
# deps materialized into node_modules/. We do NOT pass --prod because tsx
# (runtime loader for our TS-source-as-source-of-truth backend) is in
# dependencies post-edit, but it's safer to pull dev too in case other dev
# deps are imported indirectly. Then we drop the typescript / @types/* later
# to shrink the payload.
echo "[build-pkg] (3/7) pnpm deploy backend → build/payload/backend"
rm -rf "${PAYLOAD}/backend"
( cd "${REPO_ROOT}" && pnpm deploy --filter=@vessel/backend "${PAYLOAD}/backend" )

# Verify @vessel/shared got materialized — pnpm deploy stores workspace
# packages under node_modules/.pnpm/<...>/ and symlinks the top-level entry
# to that virtual-store location, so a symlink is fine AS LONG AS its target
# resolves to a path inside the deploy (not back to the workspace).
SHARED_LINK="${PAYLOAD}/backend/node_modules/@vessel/shared"
SHARED_SRC_VIA_LINK="${SHARED_LINK}/src/index.ts"
if [ ! -f "${SHARED_SRC_VIA_LINK}" ]; then
  echo "[build-pkg] FATAL: ${SHARED_SRC_VIA_LINK} missing — pnpm deploy did not materialize @vessel/shared" >&2
  exit 1
fi
SHARED_REAL="$(cd "${SHARED_LINK}" && pwd -P)"
case "${SHARED_REAL}" in
  "${PAYLOAD}"/*) ;;  # OK — resolved inside the payload
  *)
    echo "[build-pkg] FATAL: @vessel/shared resolves to ${SHARED_REAL}, outside payload ${PAYLOAD}" >&2
    echo "[build-pkg]   This will break on install because the workspace dir won't exist on the target Mac." >&2
    exit 1
    ;;
esac

# ────────────────────────────────────────────────────────────────────────────
# 4. Stage frontend dist
# ────────────────────────────────────────────────────────────────────────────
# backend/src/index.ts:191 resolves FRONTEND_DIST as path.resolve(__dirname, "../../frontend/dist")
# which from /usr/local/vessel/backend/src/index.ts → /usr/local/vessel/frontend/dist.
echo "[build-pkg] (4/7) staging frontend dist"
mkdir -p "${PAYLOAD}/frontend"
rsync -a --delete "${FRONTEND_DIST}/" "${PAYLOAD}/frontend/dist/"

# ────────────────────────────────────────────────────────────────────────────
# 5. Bundle Node binary
# ────────────────────────────────────────────────────────────────────────────
echo "[build-pkg] (5/7) bundling Node ${NODE_VERSION} (${ARCH})"
CACHED_TARBALL="${CACHE_DIR}/${NODE_DIST_FILE}"
if [ ! -f "${CACHED_TARBALL}" ]; then
  echo "[build-pkg]   downloading ${NODE_DIST_URL}"
  curl -fL --retry 3 -o "${CACHED_TARBALL}.partial" "${NODE_DIST_URL}"
  mv "${CACHED_TARBALL}.partial" "${CACHED_TARBALL}"
fi

# Verify SHASUMS to detect a corrupted/MITM'd tarball before we ship it.
SHASUM_URL="https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
EXPECTED_SHA="$(curl -fsSL "${SHASUM_URL}" | awk -v f="${NODE_DIST_FILE}" '$2 == f {print $1}')"
if [ -z "${EXPECTED_SHA}" ]; then
  echo "[build-pkg] FATAL: ${NODE_DIST_FILE} not listed in upstream SHASUMS256.txt — check NODE_VERSION/ARCH" >&2
  exit 1
fi
ACTUAL_SHA="$(shasum -a 256 "${CACHED_TARBALL}" | awk '{print $1}')"
if [ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]; then
  echo "[build-pkg] FATAL: SHA256 mismatch for ${NODE_DIST_FILE}" >&2
  echo "  expected: ${EXPECTED_SHA}" >&2
  echo "  got:      ${ACTUAL_SHA}" >&2
  rm -f "${CACHED_TARBALL}"
  exit 1
fi

mkdir -p "${PAYLOAD}/node"
tar -xzf "${CACHED_TARBALL}" -C "${PAYLOAD}/node" --strip-components=1

if [ ! -x "${PAYLOAD}/node/bin/node" ]; then
  echo "[build-pkg] FATAL: ${PAYLOAD}/node/bin/node missing after extract" >&2
  exit 1
fi

# Self-check: the bundled node must run on this host
"${PAYLOAD}/node/bin/node" --version

# ────────────────────────────────────────────────────────────────────────────
# 6. Native rebuild against bundled Node
# ────────────────────────────────────────────────────────────────────────────
# better-sqlite3 / sqlite-vec / @huggingface/transformers ship prebuilt or
# native bindings tied to a Node ABI version. If host Node ABI != bundled
# Node ABI, the .pkg will crash on the target machine with
# NODE_MODULE_VERSION mismatch. Force a rebuild using bundled Node.
echo "[build-pkg] (6/7) rebuilding native modules with bundled Node"
(
  cd "${PAYLOAD}/backend"
  export PATH="${PAYLOAD}/node/bin:${PATH}"
  # `npm` ships with the Node tarball; use it via PATH.
  npm rebuild better-sqlite3
  # --if-present-style sweep for anything else with a build script. We don't
  # care if a module has no build step — npm rebuild is a no-op there.
  npm rebuild || true
)

# ────────────────────────────────────────────────────────────────────────────
# 6.5. Trim payload
# ────────────────────────────────────────────────────────────────────────────
# pnpm deploy without --prod pulls devDeps. typescript + @types/* are
# ~50MB and unused at runtime (tsx does its own type-strip). Drop them.
TRIM_TARGETS=(
  "${PAYLOAD}/backend/node_modules/typescript"
  "${PAYLOAD}/backend/node_modules/@types"
)
for t in "${TRIM_TARGETS[@]}"; do
  if [ -e "$t" ]; then rm -rf "$t"; fi
done

# Also drop the bundled Node's npm/npx/corepack — they're only needed at
# build time. Saves ~30MB in the final .pkg.
rm -rf "${PAYLOAD}/node/lib/node_modules/npm" \
       "${PAYLOAD}/node/lib/node_modules/corepack" \
       "${PAYLOAD}/node/bin/npm" \
       "${PAYLOAD}/node/bin/npx" \
       "${PAYLOAD}/node/bin/corepack" 2>/dev/null || true

# ────────────────────────────────────────────────────────────────────────────
# 7. Stage launcher + plist template + uninstall + VERSION
# ────────────────────────────────────────────────────────────────────────────
echo "[build-pkg] (7/7) staging launcher, plist template, uninstall"
mkdir -p "${PAYLOAD}/bin" "${PAYLOAD}/share"
install -m 755 "${REPO_ROOT}/installer/vessel-backend.sh" "${PAYLOAD}/bin/vessel-backend"
install -m 644 "${REPO_ROOT}/installer/com.vessel.backend.plist.template" \
               "${PAYLOAD}/share/com.vessel.backend.plist.template"
install -m 755 "${REPO_ROOT}/installer/uninstall.sh" "${PAYLOAD}/uninstall.sh"
echo "${VERSION}" > "${PAYLOAD}/share/VERSION"

# ────────────────────────────────────────────────────────────────────────────
# Prepare scripts dir for pkgbuild
# ────────────────────────────────────────────────────────────────────────────
# pkgbuild --scripts dir must contain executable preinstall / postinstall.
# We can't pass installer/ directly because that dir also has files pkgbuild
# would try to interpret as scripts (README.md, plist template, etc.).
SCRIPTS_STAGE="${BUILD_DIR}/scripts"
rm -rf "${SCRIPTS_STAGE}"
mkdir -p "${SCRIPTS_STAGE}"
install -m 755 "${REPO_ROOT}/installer/preinstall"  "${SCRIPTS_STAGE}/preinstall"
install -m 755 "${REPO_ROOT}/installer/postinstall" "${SCRIPTS_STAGE}/postinstall"

# ────────────────────────────────────────────────────────────────────────────
# pkgbuild
# ────────────────────────────────────────────────────────────────────────────
echo "[build-pkg] running pkgbuild → ${PKG_OUT}"
rm -f "${PKG_OUT}"
pkgbuild \
  --root "${PAYLOAD}" \
  --identifier "${PKG_IDENT}" \
  --version "${VERSION}" \
  --install-location "/usr/local/vessel" \
  --scripts "${SCRIPTS_STAGE}" \
  "${PKG_OUT}"

PKG_SIZE="$(du -h "${PKG_OUT}" | awk '{print $1}')"
echo "──────────────────────────────────────────"
echo "Built: ${PKG_OUT} (${PKG_SIZE})"
echo "Smoke test (inspect contents):"
echo "  pkgutil --payload-files ${PKG_OUT} | head"
echo "Install on this Mac:"
echo "  sudo installer -pkg ${PKG_OUT} -target /"
echo "──────────────────────────────────────────"
