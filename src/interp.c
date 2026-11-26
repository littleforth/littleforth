/* interp.c - builtin table, dictionary, text interpreter, compiler words.
 *
 * Every board's startup ends here: kernel_init() sets up the system state and
 * the dictionary, then quit(), the outer interpreter, reads and runs lines
 * for ever. Board entry points: kmain() in board/pico2.c, main() in
 * board/host.c, the reset vector in board/cortexm.c (QEMU). */
#include "forth.h"
#include "cg.h"
#include "wordlist.h"

/* ---- builtin table, generated from wordlist.h ---- */
#define X(c, n, f) void w_##c(void);
WORDS(X)
#undef X
#ifdef HOST
#define X(c, n, f) w_##c,
static void (*const bi_fn[])(void) = { WORDS(X) };
#undef X
#else
/* Each builtin's address as 16 bits above KBASE, where the kernel's code is
   linked: the bo_ symbols come from board/bioff.ld.in, so the linker works
   them out, Thumb bit included. */
#ifndef KBASE
#define KBASE 0
#endif
#define X(c, n, f) ".hword bo_" #c "\n"
__asm__(".section .rodata.bi_off,\"a\"\n.balign 2\n.global bi_off\nbi_off:\n" WORDS(X) ".previous\n");
#undef X
extern const uint16_t bi_off[];
#endif
#define X(c, n, f) n f
static const char bi_names[] = WORDS(X);
#undef X
#define X(c, n, f) BI_##c,
enum { WORDS(X) NBI };
#undef X
#undef N
#undef I
#undef L

#ifdef HOST
cell bi_xt(int i)      { return (cell)(0x80000000u | (ucell)i); }
int  bi_index(cell xt) { return xt < 0 ? (int)(xt & 0xFFFF) : -1; }
#else
cell bi_xt(int i)      { return (cell)(KBASE + bi_off[i]); }
int  bi_index(cell xt) { for (int i = 0; i < NBI; i++) if (bi_xt(i) == xt) return i; return -1; }
#endif
#ifdef HOST
void bi_call(int i)    { bi_fn[i](); }
#else
void bi_call(int i)    { ((void (*)(void))bi_xt(i))(); }
#endif
int  bi_flagsof(int i)
{
    const char *p = bi_names;
    for (;; p++) if ((uint8_t)*p & 0x80 && i-- == 0) return *p & 0x7F;
}

/* ---- memory layout ---- */
cell dstack[DSTACK_GUARD + DSTACK_CELLS];      /* guard cells below the stack */
struct sys *S;
#ifdef HOST
#define DICT_START 4096
#define DICT_END   MSIZE
#else
#ifndef DICT_SIZE
#define DICT_SIZE 16384
#endif
static struct sys sysv;
uint8_t ram_dict[DICT_SIZE] __attribute__((aligned(4)));
#define DICT_START A(ram_dict)
#define DICT_END   (A(ram_dict) + DICT_SIZE)
#endif

static int up(int c) { return c >= 'a' && c <= 'z' ? c - 32 : c; }
static int match(const char *a, const char *b, cell n)
{
    while (n--) if (up(*a++) != up(*b++)) return 0;
    return 1;
}
static ucell xt_of(ucell h) { return CODE_XT((h + 5 + (C8(h + 4) & LEN_MASK) + 3) & ~3u); }

/* ---- the register table (A12, tools/regtable.py) ----
   INSTANCE.MEMBER, or INSTANCE alone, resolves to an address: the instance's
   base plus the member's offset. Looked for when the dictionary has no such
   word, before numbers (ADC is a register, not $ADC, whatever BASE is).
   REGTABLE is where the board keeps it. */
#ifdef HOST
extern const uint8_t *regtable;
#define RT regtable
#elif defined(REGTABLE)
#define RT ((const uint8_t *)REGTABLE)
#endif
#ifdef RT
#ifdef __ARM_ARCH_6M__                         /* no unaligned loads on ARMv6-M */
static ucell ld(const uint8_t *p) { return p[0] | p[1] << 8 | p[2] << 16 | (ucell)p[3] << 24; }
#else
static ucell ld(const uint8_t *p) { ucell v; __builtin_memcpy(&v, p, 4); return v; }
#endif
/* in a list of (len, name, k bytes) ending in 0: the k bytes after name s */
static const uint8_t *seek(const uint8_t *p, const char *s, cell n, int k)
{
    for (int l; (l = *p); p += l + 1 + k)
        if (l == n && match((const char *)p + 1, s, n)) return p + 1 + l;
    return 0;
}
static int reg(const char *s, cell n, cell *v, ucell *xt)
{
    const uint8_t *t = RT, *p, *ty;
    if (!t || t[3] != '3') return 0;                  /* "RTB3": erased flash ($FF) or an older table: none */
    cell d = 0, k, j;
    while (d < n && s[d] != '.') d++;
    if (!(p = seek(t + 4, s, d, 6))) return 0;
    *v = ld(p + 2);                                   /* the instance's base */
    if (d == n) return 1;
    ty = t + (p[0] | p[1] << 8);                      /* its type: name, then members */
    s += d; n -= d;                                   /* .MEMBER */
    if ((p = seek(ty + 1 + *ty, s + 1, n - 1, 3))) { *v += ld(p) & 0xFFFFFF; return 1; }
    /* a library word: GPIOA.BASE finds GPIO.BASE (the type's name), called
       with the instance's base on the stack. The name is put together in a
       buffer of its own: not at HERE, not in WORD's buffer, both of which a
       program may be using. Longer than a name can be: no such word. */
    k = *ty + n;
    if (k > LEN_MASK) return 0;
    char *w = S->dot;
    for (j = 0; j < k; j++) w[j] = j < *ty ? ty[1 + j] : s[j - *ty];
    int imm;
    return (*xt = find(A(w), k, &imm)) ? 2 : 0;
}
#else
static int reg(const char *s, cell n, cell *v, ucell *xt) { (void)s; (void)n; (void)v; (void)xt; return 0; }
#endif
ucell find(ucell a, cell n, int *imm)
{
    const char *s = P(a);
    for (ucell h = S->latest; h; h = C32(h)) {
        uint8_t f = C8(h + 4);
        if ((f & (LEN_MASK | F_HIDDEN)) == n && match(P(h + 5), s, n)) { *imm = f & F_IMM; return xt_of(h); }
    }
    int f; ucell xt;
#if defined(RT) && !defined(HOST)
    /* the library block's name table: (len, name, xt less KBASE as u16 (as
       after BL call_bi), flags (bit 0 immediate, as a builtin's)) */
    const uint8_t *b;
    if (S->blktab && (b = seek(P(S->blktab), s, n, 3))) { f = b[2]; xt = KBASE + (b[0] | b[1] << 8); goto found; }
#endif
    const char *p = bi_names;
    for (int i = 0; i < NBI; i++) {
        const char *q = p;
        while (!((uint8_t)*q & 0x80)) q++;
        if (q - p == n && match(p, s, n)) { f = *q; xt = bi_xt(i); goto found; }
        p = q + 1;
    }
    return 0;
found:
    *imm = f & BF_IMM;
    return xt;
}

/* The dictionary's end. room() is checked by , and C, and by the code
   generator for every instruction and call it writes (A14), against the end
   less GUARD: the most written between two checks (a header, a template, a
   string of at most a line) fits in GUARD, so HERE never passes the end.
   ALLOT checks both ends before it moves HERE. */
#define GUARD 256
__attribute__((noinline)) void room(void) { if (S->here > DICT_END - GUARD) throw_(-8); }

void w_here(void)   { push(S->here); }
void w_allot(void)  { ucell h = S->here + pop(); if (h - DICT_START > DICT_END - GUARD - DICT_START) throw_(-8); S->here = h; }   /* both ends */
void w_align(void)  { S->here = (S->here + 3) & ~3u; }
void comma(cell x)  { room(); w_align(); C32(S->here) = x; S->here += 4; }
void w_comma(void)  { comma(pop()); }
void w_ccomma(void) { room(); C8(S->here++) = (uint8_t)pop(); }

void header(ucell a, cell n)
{
    if (n == 0 || n > LEN_MASK) throw_(-19);
    comma(S->latest);
    S->latest = S->here - 4;
    C8(S->here++) = (uint8_t)n;
    while (n--) C8(S->here++) = C8(a++);
    w_align();
}
static void named(int flags)
{
    ucell a; cell n = parse_name(&a);
    header(a, n);
    C8(S->latest + 4) |= flags;
}

void execute(cell xt)    { cg_run(xt); }
void compile_xt(cell xt) { cg_call(xt); }

static int number(ucell a, cell n, cell *v)
{
    const char *s = P(a); int b = S->base, neg;
    if (n == 3 && s[0] == '\'' && s[2] == '\'') { *v = s[1]; return 1; }
    switch (*s) { case '#': b = 10; goto pre; case '$': b = 16; goto pre; case '%': b = 2;
    pre: s++; n--; }
    neg = n > 1 && *s == '-';
    if (neg) { s++; n--; }
    if (n <= 0) return 0;
    ucell r = 0;
    while (n--) { int d = digit(*s++); if (d >= b) return 0; r = r * b + d; }
    *v = neg ? -(cell)r : (cell)r;
    return 1;
}

void interpret(void)
{
    ucell a; cell n, v; int imm;
    while ((n = parse_name(&a))) {
        ucell xt = find(a, n, &imm);
        if (!xt) {                       /* a register, an instance's word (base, then xt), or a number */
            if (!reg(P(a), n, &v, &xt) && !number(a, n, &v)) { type(a, n); throw_(-13); }
            if (S->state) cg_lit(v); else push(v);
            imm = 0;
        }
        if (xt) { if (S->state && !imm) compile_xt(xt); else execute(xt); }
        if (psp > DS_TOP) throw_(-4);
        if (psp < dstack + DSTACK_GUARD) throw_(-3);
    }
}

/* ---- errors and the outer loop ---- */
static void *jb[5];
void throw_(cell code)
{
#if defined(__arm__) && !defined(NO_FAULT_REPORT)
    uint32_t ipsr;
    __asm volatile("mrs %0, ipsr" : "=r"(ipsr));
    if (ipsr) escape(code);                    /* in an interrupt handler: leave it first (hw.c) */
#endif
    psp = DS_TOP;                              /* first: printing uses the stack, and r5 may be bad after a fault */
    if (code != -1 && code != -2) { emit(' '); emit('?'); S->base = 10; print_num(code); cr(); }
    if (S->latest && (C8(S->latest + 4) & F_HIDDEN)) {          /* abandon a half-made definition */
        S->here = S->latest; S->latest = C32(S->latest);
    }
    S->state = 0;
    __builtin_longjmp(jb, 1);
}
void quit(void)
{
    __builtin_setjmp(jb);
    cg_init();
    for (;;) {
        S->src = A(S->tib); S->srcid = 0; S->in = 0;
        S->srclen = accept(A(S->tib), TIB_SIZE);
        if (accept_lost) throw_(-18);          /* line too long: refuse it whole */
        interpret();
        if (out_col) cr();                     /* end the reply's line */
        if (!S->state) { emit('o'); emit('k'); cr(); }   /* ok on its own line */
    }
}
void w_quit(void)  { S->state = 0; __builtin_longjmp(jb, 1); }
void w_abort(void) { throw_(-1); }
void w_pabortq(void)
{
    cell n = pop(); ucell a = pop();
    if (pop()) { type(a, n); cr(); throw_(-2); }
}
void w_evaluate(void)
{
    cell n = pop(); ucell a = pop();
    ucell os = S->src, ol = S->srclen; cell oi = S->in, oid = S->srcid;
    S->src = a; S->srclen = n; S->in = 0; S->srcid = -1;
    interpret();
    S->src = os; S->srclen = ol; S->in = oi; S->srcid = oid;
}
void w_envq(void)    { psp++; tos = 0; }
void w_execute(void) { execute(pop()); }

#ifndef ECHO
#define ECHO 1                  /* boards fed by a test runner build with ECHO=0 */
#endif
ucell dict_start(void) { return DICT_START; }
void image_restore(void);

void kernel_init(void)
{
#ifdef HOST
    S = (struct sys *)P(64);
    for (uint8_t *p = (uint8_t *)S; p < (uint8_t *)(S + 1); p++) *p = 0;   /* REBOOT comes back here */
#else
    S = &sysv;                     /* in .bss: startup clears it, and every reboot goes through startup */
#endif
    S->base = 10;
    S->echo = ECHO;
    ucell h = DICT_START;
    const ucell *b = P(BLOCKS);
    __asm__("" : "+r"(b));                                   /* one base register, not a literal per field */
    if (BLOCKS && b[0] == MAGIC) { h = b[1]; S->blktab = b[2]; }   /* a library block: start above its RAM */
    S->here = h;
    psp = DS_TOP;
    cg_init();
    image_restore();
}

/* ---- defining words ---- */
static ucell latest_xt(void) { return xt_of(S->latest); }
void w_colon(void)     { named(F_HIDDEN); cg_enter(); S->state = -1; }
void w_semicolon(void) { cg_exit(); C8(S->latest + 4) &= ~F_HIDDEN; S->state = 0; }
void w_lbracket(void)  { S->state = 0; }
void w_rbracket(void)  { S->state = -1; }
void w_immediate(void) { C8(S->latest + 4) |= F_IMM; }
void w_create(void)    { named(0); cg_create(); }
void w_variable(void)  { w_create(); comma(0); }
void w_constant(void)  { named(0); cg_enter(); cg_lit(pop()); cg_exit(); }
void w_tobody(void)    { tos = cg_body(tos); }
void w_does(void)
{
    ucell site = cg_lit_site();
    cg_call(bi_xt(BI_pdoes));
    cg_exit();
    cg_lit_patch(site, S->here);
    cg_enter();
}
void w_pdoes(void)     { cg_does(latest_xt(), pop()); }
void w_literal(void)   { cg_lit(pop()); }
static ucell tick(int *imm)
{
    ucell a; cell n = parse_name(&a);
    ucell xt = find(a, n, imm);
    if (!xt) { type(a, n); throw_(-13); }
    return xt;
}
void w_tick(void)        { int imm; push(tick(&imm)); }
void w_brackettick(void) { int imm; cg_lit(tick(&imm)); }
void w_postpone(void)
{
    int imm; ucell xt = tick(&imm);
    if (imm) compile_xt(xt);
    else { cg_lit(xt); cg_call(bi_xt(BI_compilecomma)); }
}
void w_compilecomma(void) { compile_xt(pop()); }
void w_recurse(void)      { cg_call(latest_xt()); }
void w_bracketchar(void)  { ucell a; parse_name(&a); cg_lit(C8(a)); }
void w_find(void)
{
    int imm; ucell a = tos, xt = find(a + 1, C8(a), &imm);
    if (xt) { tos = xt; push(imm ? 1 : -1); } else push(0);
}

/* ---- control structures (all immediate) ---- */
void w_if(void)     { push(cg_br(1)); }
void w_then(void)   { cg_resolve(pop(), S->here); }
void w_else(void)   { ucell s = cg_br(0); w_then(); push(s); }
void w_begin(void)  { push(S->here); }
void w_until(void)  { cg_resolve(cg_br(1), pop()); }
void w_again(void)  { cg_resolve(cg_br(0), pop()); }
void w_swap(void);
void w_while(void)  { push(cg_br(1)); w_swap(); }
void w_repeat(void) { w_again(); w_then(); }
void w_do(void)     { push(S->leave); S->leave = 0; cg_do(); push(S->here); }
static void loop_end(int plus)
{
    cg_loop(pop(), plus);
    for (ucell s = S->leave; s; ) { ucell nx = cg_chain(s); cg_resolve(s, S->here); s = nx; }
    S->leave = pop();
}
void w_loop(void)   { loop_end(0); }
void w_ploop(void)  { loop_end(1); }
void w_leave(void)  { cg_unloop(); ucell s = cg_br(0); cg_set_chain(s, S->leave); S->leave = s; }
void w_unloop(void) { cg_unloop(); }
void w_i(void)      { cg_i(); }
void w_j(void)      { cg_j(); }
void w_exit(void)   { cg_exit(); }
void w_tor(void)    { cg_tor(); }
void w_rfrom(void)  { cg_rfrom(); }
void w_rfetch(void) { cg_rfetch(); }

/* compiled string: branch over the text, then push its address and length */
static void cstring(void)
{
    ucell a; cell n = parse('"', &a);
    ucell s = cg_br(0), str = S->here;
    for (cell i = 0; i < n; i++) C8(S->here++) = C8(a + i);
    w_align();
    cg_resolve(s, S->here);
    cg_lit(str); cg_lit(n);
}
void w_dotquote(void) { cstring(); cg_call(bi_xt(BI_type)); }
void w_abortq(void)   { cstring(); cg_call(bi_xt(BI_pabortq)); }
void w_squote(void)
{
    if (S->state) { cstring(); return; }
    ucell a; cell n = parse('"', &a); push(a); push(n);
}
