#!/usr/bin/env python3
"""run_forth.py MODE FILE... - feed Forth source to a build and score the result.

MODE: a target in tools/targets/ (MODE.py gives its command line): host runs
build/host, the others a kernel under QEMU or another simulator.

Pass = the end marker was printed, tester.fr counted no errors, no
"INCORRECT RESULT" / "WRONG NUMBER OF RESULTS" line, and the kernel reported
no error (format: ?-<ANS throw code>). Prints one summary line; full output
goes to build/<mode>-<lastfile>.log. Exit status 0 only on a pass.
"""
import os, queue, re, socket, subprocess, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = ".exe" if os.name == "nt" else ""       # gcc on Windows writes build/host.exe
MARK = "@@END@@"
TAIL = "\nCR .( #ERRORS=) #ERRORS @ . CR .( " + MARK + ") CR\n"

def command(mode):
    """The command line and time limit of tools/targets/MODE.py."""
    f = os.path.join(ROOT, "tools", "targets", mode + ".py")
    if not re.fullmatch(r"\w+", mode) or not os.path.exists(f):
        modes = sorted(n[:-3] for n in os.listdir(os.path.dirname(f)) if n.endswith(".py"))
        sys.exit("mode must be one of: " + ", ".join(modes))
    g = {}
    exec(compile(open(f).read(), f, "exec"), g)
    return g["command"](ROOT, EXE)

def _feed(write, data):
    """Writer thread: send data in 256-byte pieces; stop quietly if the program exits."""
    try:
        for i in range(0, len(data), 256):
            write(data[i:i + 256])
    except OSError:
        pass

def _drain(read, q):
    """Reader thread: pass output chunks to q; b"" at end of file."""
    while True:
        try:
            chunk = read()
        except OSError:
            chunk = b""
        q.put(chunk)
        if not chunk:
            return

def _serial_socket(cmd):
    """Windows QEMU: -serial stdio does not work over pipes, so put UART0 on a
    local TCP port instead. Returns (cmd, port) or (cmd, None) if not needed."""
    if os.name != "nt" or "-serial" not in cmd or cmd[cmd.index("-serial") + 1] != "stdio":
        return cmd, None
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    cmd = list(cmd)
    cmd[cmd.index("-serial") + 1] = f"tcp:127.0.0.1:{port},server=on,wait=on"
    return cmd, port

def _connect(p, port):
    t0 = time.time()
    while True:
        try:
            return socket.create_connection(("127.0.0.1", port), timeout=1)
        except OSError:
            if p.poll() is not None or time.time() - t0 > 20:
                raise
            time.sleep(0.1)

def run(cmd, src, limit):
    """Feed src, return output up to the end marker (printed at a line start).
    Threads, not select(): on Windows select() works only on sockets."""
    cmd, port = _serial_socket(cmd)
    if port is None:
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT)
        write = lambda b: os.write(p.stdin.fileno(), b)
        read = lambda: os.read(p.stdout.fileno(), 65536)
    else:
        p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        sock = _connect(p, port)
        sock.settimeout(None)
        write = sock.sendall
        read = lambda: sock.recv(65536)
    data = src.replace("\r\n", "\n").encode("latin-1")
    q = queue.Queue()
    threading.Thread(target=_feed, args=(write, data), daemon=True).start()
    threading.Thread(target=_drain, args=(read, q), daemon=True).start()
    out, t0 = b"", time.time()
    while time.time() - t0 < limit:
        try:
            chunk = q.get(timeout=0.5)
        except queue.Empty:
            continue
        if not chunk:
            break
        out += chunk
        if re.search(rb"(^|\n)" + MARK.encode(), out.replace(b"\r", b"")):
            break
    if os.name == "nt":       # the whole tree: a target's child process would outlive it
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p.kill(); p.wait()
    return out.decode("latin-1").replace("\r", "")

def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    mode, files = sys.argv[1], sys.argv[2:]
    cmd, limit = command(mode)
    if not os.path.exists(cmd[cmd.index("-kernel") + 1] if "-kernel" in cmd else cmd[0]):
        print(f"{mode} {os.path.basename(files[-1]).split('.')[0]}: FAIL  not built")
        sys.exit(1)
    t_start = time.time()
    src = "".join(open(f, encoding="latin-1").read() + "\n" for f in files)
    src += TAIL if any(f.endswith("tester.fr") for f in files) else "\nCR .( " + MARK + ") CR\n"
    text = run(cmd, src, limit)
    t0 = time.time() - t_start
    name = os.path.basename(files[-1]).split(".")[0]
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    open(os.path.join(ROOT, "build", f"{mode}-{name}.log"), "w").write(text)
    done = re.search(r"(^|\n)" + MARK, text) is not None
    incorrect = len(re.findall(r"(^|\n)INCORRECT RESULT", text))
    wrong = len(re.findall(r"(^|\n)WRONG NUMBER OF RESULTS", text))
    kerr = re.findall(r"\?-\d+", text)
    m = re.search(r"#ERRORS=\s*(-?\d+)", text)
    nerr = int(m.group(1)) if m else None
    ok = done and incorrect == 0 and wrong == 0 and not kerr and (nerr in (0, None))
    print(f"{mode} {name}: {'PASS' if ok else 'FAIL'}  finished={done} "
          f"incorrect={incorrect} wrong-count={wrong} kernel-errors={len(kerr)} "
          f"#ERRORS={nerr}  time={t0:.1f}s")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
