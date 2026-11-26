/* forth.h - shared by every kernel file, host and target.
 *
 * Forth addresses are 32-bit cells. On the target they are real addresses.
 * On the host they index the array M, so the same kernel code runs on both:
 * P(a) turns a Forth address into a C pointer, A(p) turns it back.
 *
 * The data stack: top of stack in `tos`, the rest below `psp` (full
 * descending). On the target both are global register variables (r6, r5),
 * reserved for the whole program with -ffixed-r6 -ffixed-r5, so native code
 * and C words share them with no glue.
 */
#ifndef FORTH_H
#define FORTH_H
#include <stdint.h>
#include <stddef.h>

typedef int32_t cell;
typedef uint32_t ucell;
typedef int64_t dcell;
typedef uint64_t udcell;

#ifdef HOST
extern cell tos;
extern cell *psp;
extern uint8_t M[];
#define MSIZE  (1u << 20)
#define P(a)   ((void *)(M + ((ucell)(a) & (MSIZE - 1))))
#define A(p)   ((ucell)((const uint8_t *)(p) - M))
#else
register cell tos asm("r6");
register cell *psp asm("r5");
#define P(a)   ((void *)(uintptr_t)(ucell)(a))
#define A(p)   ((ucell)(uintptr_t)(p))
#endif

/* where code runs: data address + CODE_ALIAS; xts carry the Thumb bit */
#ifdef HOST
#undef CODE_ALIAS
#define CODE_ALIAS 0
#define CODE_XT(a) (a)
#else
#ifndef CODE_ALIAS
#define CODE_ALIAS 0
#endif
#define CODE_XT(a) ((((ucell)(a)) + CODE_ALIAS) | 1)
#endif

#define C8(a)  (*(uint8_t *)P(a))
#define C32(a) (*(cell *)P(a))

static inline void push(cell x) { *--psp = tos; tos = x; }
static inline cell pop(void) { cell t = tos; tos = *psp++; return t; }
static inline udcell dpop(void) { udcell hi = (ucell)pop(); return (hi << 32) | (ucell)pop(); }
static inline void dpush(udcell d) { push((cell)d); push((cell)(d >> 32)); }
ucell udivmod(udcell *n, ucell d);

/* Forth-visible system variables and buffers. Lives in Forth memory: its
   fields have Forth addresses (BASE, STATE, >IN return them). */
#define TIB_SIZE  128
#define HOLD_SIZE 72
struct sys {
    cell state, base, in;          /* STATE BASE >IN                    */
    ucell src, srclen;             /* SOURCE                            */
    cell srcid;                    /* 0 console, -1 EVALUATE            */
    ucell here, latest;            /* dictionary pointer, newest header */
    ucell leave;                   /* LEAVE chain while compiling a loop */
    ucell hld;                     /* pictured numeric output pointer   */
    cell echo;                     /* ACCEPT echoes input when set      */
    ucell blktab;                  /* library block name table, 0: none; set at boot from the block header, the builder points it at its RAM table */
    char dot[32];                  /* TYPE.WORD, put together for INSTANCE.WORD */
    char tib[TIB_SIZE];
    char word[66];                 /* WORD: counted string              */
    char hold[HOLD_SIZE];          /* <# ... #> builds down from the end */
};
extern struct sys *S;
/* 64 cells of data stack, with 64 guard cells below. The depth is checked
   between interpreted words: a compiled word may run up to 64 cells past the
   limit before memory below the guard is hit, and the overflow is then
   reported as ?-3 when control returns to the interpreter. */
#define DSTACK_CELLS 64
#define DSTACK_GUARD 64
extern cell dstack[];
#define DS_TOP (dstack + DSTACK_GUARD + DSTACK_CELLS - 1)   /* psp when empty */

/* header of a word defined at run time (in the dictionary):
   link (4) | flags+len (1) | name (len) | pad to 4 | code (xt)            */
#define F_IMM    0x80
#define F_HIDDEN 0x40
#define LEN_MASK 0x1F

/* The magic of a SAVE image and of a library block: "FORT" and the kernel
   build's STAMP (Makefile), so neither is used with another build. */
#ifndef STAMP
#define STAMP 0u
#endif
#define MAGIC (0x464F5254u ^ STAMP)
/* Library blocks: a board with BLOCKS keeps one at
   that flash address. Its header: MAGIC, HERE above its RAM, the address of
   its name table, the table's length. 0: none. */
#ifndef BLOCKS
#define BLOCKS 0u
#endif

/* kernel services */
void throw_(cell code) __attribute__((noreturn));
void escape(cell code) __attribute__((noreturn));
void execute(cell xt);
void compile_xt(cell xt);
ucell find(ucell a, cell n, int *imm);    /* xt or 0 */
void interpret(void);
void quit(void) __attribute__((noreturn));
void type(ucell a, cell n);
void emit(int c);
void cr(void);
void print_num(cell n);
cell parse(int delim, ucell *a);          /* length; *a = start */
cell parse_name(ucell *a);
cell accept(ucell a, cell max);
extern int accept_lost;
extern uint8_t out_col;
int  digit(int c);
void comma(cell x);
void header(ucell a, cell n);
void kernel_init(void);
ucell dict_start(void);

/* board services */
int  con_key(void);                       /* blocks; -1 at end of input */
void con_emit(int c);

/* builtin word table (interp.c) */
cell bi_xt(int i);
int  bi_index(cell xt);                   /* -1 if not a builtin */
int  bi_flagsof(int i);
void bi_call(int i);
#define BF_IMM    0x01
#define BF_INLINE 0x02

#endif
