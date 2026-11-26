/* cg_token.c - host code generator: one token per cell, run by vm().
 * The reference implementation the Thumb-2 generator is checked against.
 * Return stack layout matches the target: loop index on top, limit below.
 */
#include "forth.h"
#include "cg.h"

enum { T_CALL = 1, T_LIT, T_EXIT, T_BR, T_BR0, T_DO, T_LOOP, T_PLOOP, T_UNLOOP,
       T_I, T_J, T_TOR, T_RFROM, T_RFETCH, T_NOP };

#define RS_CELLS 256
static cell rs[RS_CELLS];
static int rp;

static void tok(cell t) { comma(t); }
static ucell site(cell t) { tok(t); ucell s = S->here; tok(0); return s; }

void  cg_init(void)        { rp = 0; }
void  cg_enter(void)       { }
void  cg_exit(void)        { tok(T_EXIT); }
void  cg_call(cell xt)     { tok(T_CALL); tok(xt); }
void  cg_lit(cell n)       { tok(T_LIT); tok(n); }
ucell cg_lit_site(void)    { return site(T_LIT); }
void  cg_lit_patch(ucell s, cell n) { C32(s) = n; }
ucell cg_br(int cond)      { return site(cond ? T_BR0 : T_BR); }
void  cg_resolve(ucell s, ucell d)  { C32(s) = d; }
ucell cg_chain(ucell s)    { return C32(s); }
void  cg_set_chain(ucell s, ucell n) { C32(s) = n; }
void  cg_do(void)          { tok(T_DO); }
void  cg_loop(ucell d, int plus) { tok(plus ? T_PLOOP : T_LOOP); tok(d); }
void  cg_unloop(void)      { tok(T_UNLOOP); }
void  cg_i(void)           { tok(T_I); }
void  cg_j(void)           { tok(T_J); }
void  cg_tor(void)         { tok(T_TOR); }
void  cg_rfrom(void)       { tok(T_RFROM); }
void  cg_rfetch(void)      { tok(T_RFETCH); }
/* CREATE: LIT body EXIT NOP, body = xt + 16. DOES> turns EXIT NOP into BR dest. */
void  cg_create(void)      { ucell xt = S->here; tok(T_LIT); tok(xt + 16); tok(T_EXIT); tok(T_NOP); }
void  cg_does(ucell xt, ucell d) { C32(xt + 8) = T_BR; C32(xt + 12) = d; }
ucell cg_body(ucell xt)    { return C32(xt + 4); }

static void rpush(cell x) { if (rp >= RS_CELLS) throw_(-5); rs[rp++] = x; }

static void vm(ucell ip)
{
    int base = rp;
    for (;;) {
        cell t = C32(ip), x;
        ip += 4;
        switch (t) {
        case T_CALL:
            x = C32(ip); ip += 4;
            if (x < 0) bi_call(x & 0xFFFF);
            else { rpush(ip); ip = x; }
            break;
        case T_LIT:    push(C32(ip)); ip += 4; break;
        case T_EXIT:   if (rp <= base) return; ip = rs[--rp]; break;
        case T_BR:     ip = C32(ip); break;
        case T_BR0:    ip = pop() ? ip + 4 : (ucell)C32(ip); break;
        case T_DO:     x = pop(); rpush(pop()); rpush(x); break;
        case T_LOOP:
            if (++rs[rp - 1] == rs[rp - 2]) { rp -= 2; ip += 4; } else ip = C32(ip);
            break;
        case T_PLOOP: {
            /* terminates when index crosses limit-1|limit: signed overflow of
               (index - limit) ^ 0x80000000 + n, the same test the target uses */
            cell n = pop();
            cell d = (cell)(((ucell)rs[rp - 1] - (ucell)rs[rp - 2]) ^ 0x80000000u);
            rs[rp - 1] = (cell)((ucell)rs[rp - 1] + (ucell)n);
            dcell s = (dcell)d + n;
            if (s != (cell)s) { rp -= 2; ip += 4; } else ip = C32(ip);
            break;
        }
        case T_UNLOOP: rp -= 2; break;
        case T_I:      push(rs[rp - 1]); break;
        case T_J:      push(rs[rp - 3]); break;
        case T_TOR:    rpush(pop()); break;
        case T_RFROM:  push(rs[--rp]); break;
        case T_RFETCH: push(rs[rp - 1]); break;
        case T_NOP:    break;
        default:       throw_(-9);
        }
    }
}

void cg_run(cell xt)
{
    if (xt < 0) bi_call(xt & 0xFFFF);
    else vm(xt);
}
