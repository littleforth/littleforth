/* io.c - console words, pictured numeric output, number conversion, parsing. */
#include "forth.h"

uint8_t out_col;                     /* something printed on this line */
void emit(int c)            { con_emit(c); out_col = c != '\n'; }
void type(ucell a, cell n)  { const char *p = P(a); while (n-- > 0) emit(*p++); }
void cr(void)               { emit('\n'); }

void w_emit(void)   { emit(pop()); }
void w_key(void)    { push(con_key()); }
void w_cr(void)     { cr(); }
void w_space(void)  { emit(' '); }
void w_spaces(void) { cell n = pop(); while (n-- > 0) emit(' '); }
void w_type(void)   { cell n = pop(); type(pop(), n); }

int accept_lost;                     /* characters dropped by the last accept */
cell accept(ucell a, cell max)
{
    char *p = P(a); cell n = 0;
    accept_lost = 0;
    for (;;) {
        int c = con_key();
        if (c == '\r' || c == '\n' || c < 0) {
            if (S->echo) cr();           /* the reply starts on its own line */
            return n;
        }
        if (c == 8 || c == 127) {
            if (n) { n--; if (S->echo) { emit(8); emit(' '); emit(8); } }
        } else if (n < max) {
            p[n++] = (char)c;
            if (S->echo) emit(c);
        } else accept_lost = 1;
    }
}
void w_accept(void) { cell n = pop(); tos = accept(tos, n); }

/* ---- pictured numeric output ---- */
#define HOLD_END A(S->hold + HOLD_SIZE)
static void hold(int c)
{
    if (S->hld <= A(S->hold)) throw_(-17);
    C8(--S->hld) = (uint8_t)c;
}
void w_lessnum(void)  { S->hld = HOLD_END; }
void w_hold(void)     { hold(pop()); }
void w_sign(void)     { if (pop() < 0) hold('-'); }
void w_num(void)
{
    udcell d = dpop();
    ucell r = udivmod(&d, S->base);
    hold(r < 10 ? '0' + r : 'A' - 10 + r);
    dpush(d);
}
void w_nums(void)       { do w_num(); while (tos | psp[0]); }
void w_numgreater(void) { psp++; tos = S->hld; push(HOLD_END - S->hld); }

static void dot(udcell d, int neg)
{
    w_lessnum(); dpush(d); w_nums();
    if (neg) hold('-');
    w_numgreater(); w_type(); emit(' ');
}
void print_num(cell n) { dot(n < 0 ? -(ucell)n : (ucell)n, n < 0); }
void w_dot(void)       { print_num(pop()); }
void w_udot(void)      { dot((ucell)pop(), 0); }

/* ---- number conversion ---- */
int digit(int c)
{
    if (c >= '0' && c <= '9') c -= '0';
    else if ((c | 0x20) >= 'a' && (c | 0x20) <= 'z') c = (c | 0x20) - 'a' + 10;
    else return 99;
    return c;
}
void w_tonumber(void)
{
    cell n = pop(); ucell a = pop(); udcell d = dpop(); int v;
    while (n && (v = digit(C8(a))) < S->base) { d = d * (ucell)S->base + v; a++; n--; }
    dpush(d); push(a); push(n);
}

/* ---- parsing the input source ---- */
cell parse(int delim, ucell *a)
{
    const char *src = P(S->src);
    cell i = S->in, n = S->srclen, start = i;
    while (i < n && !(delim == ' ' ? (uint8_t)src[i] <= ' ' : src[i] == delim)) i++;
    *a = S->src + start;
    S->in = i < n ? i + 1 : i;
    return i - start;
}
static void skip(int delim)
{
    const char *src = P(S->src);
    while (S->in < (cell)S->srclen &&
           (delim == ' ' ? (uint8_t)src[S->in] <= ' ' : src[S->in] == delim)) S->in++;
}
cell parse_name(ucell *a) { skip(' '); return parse(' ', a); }

void w_word(void)
{
    ucell a; int delim = tos;
    skip(delim);
    cell n = parse(delim, &a);
    if (n > 64) n = 64;
    S->word[0] = (char)n;
    for (cell i = 0; i < n; i++) S->word[1 + i] = C8(a + i);
    S->word[1 + n] = ' ';
    tos = A(S->word);
}
void w_char(void)      { ucell a; parse_name(&a); push(C8(a)); }
void w_paren(void)     { ucell a; parse(')', &a); }
void w_backslash(void) { S->in = S->srclen; }
void w_dotparen(void)  { ucell a; cell n = parse(')', &a); type(a, n); }
void w_source(void)    { push(S->src); push(S->srclen); }
void w_toin(void)      { push(A(&S->in)); }
void w_base(void)      { push(A(&S->base)); }
void w_state(void)     { push(A(&S->state)); }
void w_decimal(void)   { S->base = 10; }
void w_hex(void)       { S->base = 16; }
