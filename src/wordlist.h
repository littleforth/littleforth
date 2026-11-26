/* wordlist.h - every builtin word: X(c-name, "FORTH NAME", flags).
 * The C function is w_<c-name>. Flags: N none, I immediate, L may be copied
 * inline by the target code generator (checked by the build).
 * Order matters only for speed of FIND: commonest first.
 */
#define N "\x80"
#define I "\x81"
#define L "\x82"
/* boards built with FORTH_SAVE take SAVE and EMPTY from a Forth file (lib/save.fth) */
#ifdef FORTH_SAVE
#define SAVEW(X)
#else
#define SAVEW(X) X(save,"SAVE",N) X(empty,"EMPTY",N)
#endif
#define WORDS(X) \
 X(dup,"DUP",L) X(drop,"DROP",L) X(swap,"SWAP",L) X(over,"OVER",L) X(rot,"ROT",L) \
 X(qdup,"?DUP",N) X(nip,"NIP",L) X(tuck,"TUCK",N) X(twodup,"2DUP",N) X(twodrop,"2DROP",L) \
 X(twoswap,"2SWAP",N) X(twoover,"2OVER",N) X(depth,"DEPTH",N) \
 X(plus,"+",L) X(minus,"-",L) X(star,"*",L) X(slash,"/",N) X(mod,"MOD",N) \
 X(slashmod,"/MOD",N) X(starslash,"*/",N) X(starslashmod,"*/MOD",N) X(negate,"NEGATE",L) \
 X(abs,"ABS",N) X(min,"MIN",N) X(max,"MAX",N) X(oneplus,"1+",L) X(oneminus,"1-",L) \
 X(twostar,"2*",L) X(twoslash,"2/",L) X(lshift,"LSHIFT",L) X(rshift,"RSHIFT",L) \
 X(and,"AND",L) X(or,"OR",L) X(xor,"XOR",L) X(invert,"INVERT",L) X(mstar,"M*",N) \
 X(umstar,"UM*",N) X(ummod,"UM/MOD",N) X(fmmod,"FM/MOD",N) X(smrem,"SM/REM",N) X(stod,"S>D",L) \
 X(zeq,"0=",L) X(zlt,"0<",L) X(eq,"=",L) X(lt,"<",L) X(gt,">",L) X(ult,"U<",L) \
 X(ne,"<>",L) X(zne,"0<>",L) \
 X(fetch,"@",L) X(store,"!",L) X(cfetch,"C@",L) X(cstore,"C!",L) X(hfetch,"H@",L) X(hstore,"H!",L) \
 X(plusstore,"+!",N) X(twofetch,"2@",N) X(twostore,"2!",N) X(comma,",",N) X(ccomma,"C,",N) \
 X(allot,"ALLOT",N) X(align,"ALIGN",N) X(aligned,"ALIGNED",N) X(here,"HERE",N) X(cells,"CELLS",L) \
 X(cellplus,"CELL+",L) X(chars,"CHARS",L) X(charplus,"CHAR+",L) X(count,"COUNT",N) X(fill,"FILL",N) X(move,"MOVE",N) \
 X(bl,"BL",N) X(true,"TRUE",N) X(false,"FALSE",N) X(state,"STATE",N) X(base,"BASE",N) X(toin,">IN",N) \
 X(source,"SOURCE",N) X(decimal,"DECIMAL",N) X(hex,"HEX",N) \
 X(emit,"EMIT",N) X(key,"KEY",N) X(cr,"CR",N) X(space,"SPACE",N) X(spaces,"SPACES",N) X(type,"TYPE",N) \
 X(accept,"ACCEPT",N) X(dot,".",N) X(udot,"U.",N) X(lessnum,"<#",N) X(num,"#",N) X(nums,"#S",N) \
 X(numgreater,"#>",N) X(hold,"HOLD",N) X(sign,"SIGN",N) X(tonumber,">NUMBER",N) \
 X(word,"WORD",N) X(char,"CHAR",N) X(bracketchar,"[CHAR]",I) X(paren,"(",I) X(backslash,"\\",I) \
 X(dotparen,".(",I) X(find,"FIND",N) X(tick,"'",N) X(brackettick,"[']",I) X(execute,"EXECUTE",N) \
 X(evaluate,"EVALUATE",N) X(quit,"QUIT",N) X(abort,"ABORT",N) X(abortq,"ABORT\"",I) \
 X(envq,"ENVIRONMENT?",N) X(lbracket,"[",I) X(rbracket,"]",N) \
 X(colon,":",N) X(semicolon,";",I) X(create,"CREATE",N) X(does,"DOES>",I) X(variable,"VARIABLE",N) \
 X(constant,"CONSTANT",N) X(immediate,"IMMEDIATE",N) X(tobody,">BODY",N) X(literal,"LITERAL",I) \
 X(postpone,"POSTPONE",I) X(compilecomma,"COMPILE,",N) X(recurse,"RECURSE",I) \
 X(if,"IF",I) X(else,"ELSE",I) X(then,"THEN",I) X(begin,"BEGIN",I) X(until,"UNTIL",I) \
 X(again,"AGAIN",I) X(while,"WHILE",I) X(repeat,"REPEAT",I) X(do,"DO",I) X(loop,"LOOP",I) \
 X(ploop,"+LOOP",I) X(i,"I",I) X(j,"J",I) X(leave,"LEAVE",I) X(unloop,"UNLOOP",I) X(exit,"EXIT",I) \
 X(tor,">R",I) X(rfrom,"R>",I) X(rfetch,"R@",I) X(dotquote,".\"",I) X(squote,"S\"",I) \
 SAVEW(X) X(reboot,"REBOOT",N) X(irqstore,"IRQ!",N) \
 X(eint,"EINT",N) X(dint,"DINT",N) X(pdoes,"(DOES>)",N) X(pabortq,"(ABORT\")",N)
