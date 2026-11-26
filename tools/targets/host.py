"""host: build/host (the token code generator), source on stdin."""
import os
def command(root, exe):
    os.environ.setdefault("FORTH_REGS", os.path.join(root, "build", "rp2350.tbl"))   # A12 register table
    return [os.path.join(root, "build", "host" + exe)], 120
