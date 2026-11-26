// boards/pico2.js - the RP2350 on the Raspberry Pi Pico 2 and Pico 2 W
// (board/pico2.c): console on UART0, GP0/GP1, through the Raspberry Pi Debug Probe.
'use strict';
module.exports = {
  id: 'pico2',
  name: 'Pico 2',
  order: 1,
  chip: 'rp2350',
  dictSize: 65536,
  firmware: ['pico2.uf2'],
  probes: [['2e8a', '000c']],                      // the Debug Probe's serial port
  openocd: ['-c', 'set USE_CORE cm0', '-f', 'interface/cmsis-dap.cfg', '-f', 'target/rp2350.cfg', '-c', 'adapter speed 5000'],
  flashDriver: 'flash.fth',                        // SAVE is Forth (lib/rp2350/drivers)
  picture: true,                                   // boardpic.js
  // through the BOOTSEL drive if one is mounted, else through the probe
  flash(fw, { F, openocd }) {
    return F.uf2Drives().length || !openocd ? () => F.flashPico2(fw) : () => F.flashPico2Swd(fw, openocd);
  },
};
