#!/usr/bin/env bash

set -eu

BASE_DIR="$(dirname "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)")"
EXT_DIR="${BASE_DIR}/extension"
TMP_DIR=$(mktemp -d)
DEST="${TMP_DIR}/recommender-core"
mkdir -p $DEST

# deletes the temp directory
function cleanup {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

while read -r LINE || [[ -n "${LINE}" ]]; do
  mkdir -p "$(dirname "${DEST}/${LINE}")"
  cp -r "${EXT_DIR}/${LINE}" "$(dirname "${DEST}/${LINE}")"
done < "${EXT_DIR}/build-includes.txt"

pushd $DEST
zip -r recommender-core.xpi *
mv recommender-core.xpi $BASE_DIR
popd
