# the extension: its data must match lib/ and the builds (X1 is in both groups:
# kernel and lib/ changes can make it stale), then its tests
vsdata() {
    t=$(mktemp -d); python3 -I tools/vscode_data.py "$t" >/dev/null && diff -rq -x "*.periph.json" "$t" extension/data; r=$?; rm -rf "$t"; return $r
}
gate kv "X1 VS Code data"   vsdata
gate v  "X2 VS Code tests"  sh -c 'cd extension && npm test --silent'
