\ save.fth - SAVE / REBOOT / EMPTY round trip (compare save.expect).
\ (QEMU's Cortex-M0 board drops the UART's few unread bytes at a reset: a blank line takes the loss)
EMPTY REBOOT
                
: KEPT 111 ; VARIABLE KV 222 KV ! SAVE
: LOST 333 ;
REBOOT
                
KEPT . KV @ .
LOST
EMPTY REBOOT
                
KEPT
