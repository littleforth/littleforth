"""forthsource.py - INCLUDE expansion and lines to send.

`\\ INCLUDE path` on a line of its own (a `\\ comment` may follow) pulls in
another file. It is a comment to the board, so a file with includes still
loads by plain paste (without the included files). The path is looked for
next to the including file, then in each search root (the project folder).
Each file is sent once: a file already included is skipped. Blank lines and
lines that are only a `\\` comment are not sent.

skip: folders whose files the board already has (its register table, A12):
an include found in one is left out, and listed in _skipped.
"""
import os
import re

INCLUDE_RE = re.compile(r"^\s*\\\s+INCLUDE\s+(\S+)\s*(?:\\(?:\s.*)?)?$")   # INCLUDE in capitals: prose comments may say "include"
INCLUDE_ANY = re.compile(r"^\s*\\\s+INCLUDE\b")     # looks like one: refuse if malformed


class SourceError(Exception):
    def __init__(self, path, line, msg):
        super().__init__(f"{path}:{line}: {msg}")
        self.path, self.line, self.msg = path, line, msg


class Line:
    __slots__ = ("path", "no", "text")

    def __init__(self, path, no, text):
        self.path, self.no, self.text = path, no, text

    def __repr__(self):
        return f"{os.path.basename(self.path)}:{self.no}: {self.text}"


def find_include(name, from_path, roots):
    for d in [os.path.dirname(os.path.abspath(from_path))] + [os.path.abspath(r) for r in roots]:
        p = os.path.normpath(os.path.join(d, name))
        if os.path.isfile(p):
            return p
    return None


def expand(path, roots=(), text=None, _stack=None, _files=None, _seen=None, skip=(), _skipped=None):
    """Lines to send, in order. text: the file's contents if already in memory
    (the editor's unsaved copy). _files collects (path, lines sent) per file."""
    path = os.path.abspath(path)
    stack = _stack if _stack is not None else []
    files = _files if _files is not None else []
    seen = _seen if _seen is not None else set()
    if path in stack:
        chain = " -> ".join(os.path.basename(p) for p in stack + [path])
        raise SourceError(stack[-1], 0, f"include loop: {chain}")
    if path in seen:
        return []
    seen.add(path)
    if text is None:
        with open(path, encoding="latin-1") as f:
            text = f.read()
    stack.append(path)
    out = []
    count = [path, 0]
    files.append(count)
    for no, raw in enumerate(text.replace("\r\n", "\n").split("\n"), 1):
        m = INCLUDE_RE.match(raw)
        if m:
            inc = find_include(m.group(1), path, roots)
            if inc is None:
                raise SourceError(path, no, f"include file not found: {m.group(1)}")
            if any(os.path.normcase(os.path.dirname(inc)) == os.path.normcase(os.path.abspath(d)) for d in skip):
                if _skipped is not None and inc not in _skipped:
                    _skipped.append(inc)
                continue
            try:
                out += expand(inc, roots, None, stack, files, seen, skip, _skipped)
            except SourceError as e:
                if e.line == 0:                     # the loop: report it at this line
                    raise SourceError(path, no, e.msg)
                raise
            continue
        if INCLUDE_ANY.match(raw):
            raise SourceError(path, no, "include line not understood: \\ INCLUDE path  [\\ comment]")
        s = raw.replace("\t", " ").rstrip()
        t = s.strip()
        if not t or t == "\\" or t.startswith("\\ "):
            continue
        out.append(Line(path, no, s))
        count[1] += 1
    stack.pop()
    return out


def file_counts(path, roots=(), text=None):
    """[(path, lines)] for the file and every include, in send order of first line."""
    files = []
    expand(path, roots, text, None, files)
    return [(p, n) for p, n in files]


def _tokens(line):
    """Forth tokens of one line, without comments and string bodies:
    ( ... ) and \\ ... comments, and the text of ." S" .( ABORT" C" are skipped."""
    out, i, n = [], 0, len(line)
    while i < n:
        while i < n and line[i] in " \t":
            i += 1
        j = i
        while j < n and line[j] not in " \t":
            j += 1
        tok = line[i:j]
        if not tok:
            break
        u = tok.upper()
        if tok == "\\":
            break
        if tok == "(" or tok == ".(":
            k = line.find(")", j)
            i = n if k < 0 else k + 1
            continue
        if u in ('."', 'S"', 'ABORT"', 'C"'):
            k = line.find('"', j + 1)
            i = n if k < 0 else k + 1
            continue
        out.append((tok, i))
        i = j
    return out


def definitions(path, text=None, known=(), _definers=None):
    """{NAME: (stack comment, comment above, path, line)} for the words a file
    defines: `: NAME ( stack )`, and VARIABLE, CONSTANT, CREATE outside a
    definition. The comment above is the block of `\\` lines just before the
    definition; failing that, a `\\` comment at the end of its line. A word whose
    definition uses :, CREATE, VARIABLE, CONSTANT or another such word defines
    words too: `CODE NAME ( stack )` defines NAME. known: such words other files
    make; _definers, a set, collects this file's."""
    if text is None:
        try:
            with open(path, encoding="latin-1") as f:
                text = f.read()
        except OSError:
            return {}
    out = {}
    lines = text.replace("\r\n", "\n").split("\n")
    builtin = ("VARIABLE", "CONSTANT", "CREATE")
    definers = _definers if _definers is not None else set()   # words that define words (CODE, reg:), as model.js
    def is_definer(u):
        return u in builtin or u == "CODE" or u in definers or u in known
    compiling, current, quoted = False, None, False
    for i, raw in enumerate(lines):
        toks = _tokens(raw)
        found = []
        for k, (tok, pos) in enumerate(toks):
            u = tok.upper()
            if quoted:
                quoted = False
                continue
            if compiling and u in ("'", "[']", "POSTPONE"):          # POSTPONE ; is not the end
                if current and k + 1 < len(toks) and (toks[k + 1][0] == ":" or is_definer(toks[k + 1][0].upper())):
                    definers.add(current)
                quoted = True
                continue
            if u == ":" and not compiling and k + 1 < len(toks):
                name, npos = toks[k + 1]
                m = re.match(r"\s*(\([^)]*\))", raw[npos + len(name):])    # ( stack ) right after the name
                found.append((name, m.group(1) if m else ""))
                compiling, current = True, name.upper()
            elif u == ";":
                compiling, current = False, None
            elif compiling:
                if current and (u == ":" or is_definer(u)):
                    definers.add(current)
            elif is_definer(u) and k + 1 < len(toks):
                name, npos = toks[k + 1]
                stack = u
                if u not in builtin:
                    m = re.match(r"\s*(\([^)]*\))", raw[npos + len(name):])
                    if m:
                        stack = m.group(1)
                found.append((name, stack))
        if not found:
            continue
        above, j = [], i - 1
        while j >= 0 and lines[j].lstrip().startswith("\\ ") and not INCLUDE_ANY.match(lines[j]):
            above.insert(0, lines[j].strip()[2:])
            j -= 1
        trailing = raw.split(" \\ ", 1)[1].strip() if " \\ " in raw else ""
        for name, stack in found:
            note = " ".join(above) or trailing
            if note.upper().startswith(name.upper() + " "):     # "NAME ( -- )  text": keep the text
                note = re.sub(r"^\S+\s+(\([^)]*\)\s*)?", "", note)
            out[name.upper()] = (stack, note, path, i + 1)
    return out


def definers(path, text=None):
    """The defining words a file makes (CODE, reg:), for definitions(known=)."""
    out = set()
    definitions(path, text, _definers=out)
    return out
