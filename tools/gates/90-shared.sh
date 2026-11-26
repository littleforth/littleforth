# the assembler, and every board's programmed files (tools/images/)
gate k  "X3 asm encodings"  python3 -I tools/asmcheck.py encodings
gate k  "E5 images"         python3 -I tools/imagecheck.py
gate k  "docs words"        sh -c 't=$(mktemp); python3 -I tools/wordsdoc.py "$t" && diff -q "$t" docs/words.md; r=$?; rm -f "$t"; exit $r'
