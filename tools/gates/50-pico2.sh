# the Pico 2 / Pico 2 W
gate kq "build pico2"       make -s build/pico2.uf2
gate kq "T1p/T7p pico2"     tools/sizegate.sh build/pico2.elf build/pico2.bin
gate kq "inline pico2"      tools/inlinecheck.sh build/pico2.elf
# in quick too: any change to the kernel's RAM layout (even the banner) moves these
gate kq "kernel.fth pico2"  kfth pico2 rp2350
