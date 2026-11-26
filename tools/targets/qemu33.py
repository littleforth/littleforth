"""qemu33: build/an505.elf on QEMU's mps2-an505, a Cortex-M33 (the RP2350's core)."""
import os
def command(root, exe):
    return ["qemu-system-arm", "-M", "mps2-an505",
            "-nographic", "-monitor", "none", "-serial", "stdio",
            "-kernel", os.path.join(root, "build", "an505.elf"),
            "-device", "loader,file=" + os.path.join(root, "build", "rp2350.tbl") + ",addr=0x10080000"], 600
