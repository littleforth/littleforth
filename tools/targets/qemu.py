"""qemu: build/mps2.bin on qemu-system-arm -M mps2-an386 (Cortex-M4), source on UART0."""
import os
def command(root, exe):
    return ["qemu-system-arm", "-M", "mps2-an386",
            "-nographic", "-monitor", "none", "-serial", "stdio",
            "-kernel", os.path.join(root, "build", "mps2.bin"),
            "-device", "loader,file=" + os.path.join(root, "build", "rp2350.tbl") + ",addr=0x80000"], 600
