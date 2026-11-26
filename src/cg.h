/* cg.h - code generator interface. The only part of the kernel that knows the
 * output format. cg_token.c (host) and cg_thumb.c (target) implement it.
 * A "site" is the Forth address of a branch or literal that is patched later.
 */
#ifndef CG_H
#define CG_H
#include "forth.h"

void  cg_enter(void);                 /* start of a colon definition        */
void  cg_exit(void);                  /* return: EXIT and ;                 */
void  cg_call(cell xt);               /* call xt, or copy it inline         */
void  cg_lit(cell n);                 /* push n                             */
ucell cg_lit_site(void);              /* push a literal patched later       */
void  cg_lit_patch(ucell site, cell n);
ucell cg_br(int cond);                /* cond: pop, branch if zero          */
void  cg_resolve(ucell site, ucell dest);
ucell cg_chain(ucell site);           /* LEAVE chain kept in an open site   */
void  cg_set_chain(ucell site, ucell next);
void  cg_do(void);
void  cg_loop(ucell dest, int plus);  /* LOOP or +LOOP back to dest         */
void  cg_unloop(void);
void  cg_i(void);
void  cg_j(void);
void  cg_tor(void);
void  cg_rfrom(void);
void  cg_rfetch(void);
void  cg_create(void);                /* code of a CREATEd word             */
void  cg_does(ucell xt, ucell dest);  /* that word then branches to dest    */
ucell cg_body(ucell xt);              /* >BODY                              */
void  cg_run(cell xt);                /* execute xt                         */
void  cg_init(void);
#endif
