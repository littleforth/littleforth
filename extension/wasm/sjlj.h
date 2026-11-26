/* sjlj.h - included first in every file of the WebAssembly build (build.sh) */
int wsetjmp(void *jb);
__attribute__((noreturn)) void wlongjmp(void *jb, int v);
