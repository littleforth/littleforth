"""forthbuiltins.py - the kernel's builtin word names, from src/wordlist.h.

It must match src/wordlist.h.
"""
BUILTINS = (
    'DUP', 'DROP', 'SWAP', 'OVER', 'ROT', '?DUP', 'NIP', 'TUCK', '2DUP',
    '2DROP', '2SWAP', '2OVER', 'DEPTH', '+', '-', '*', '/', 'MOD', '/MOD',
    '*/', '*/MOD', 'NEGATE', 'ABS', 'MIN', 'MAX', '1+', '1-', '2*', '2/',
    'LSHIFT', 'RSHIFT', 'AND', 'OR', 'XOR', 'INVERT', 'M*', 'UM*', 'UM/MOD',
    'FM/MOD', 'SM/REM', 'S>D', '0=', '0<', '=', '<', '>', 'U<', '<>', '0<>',
    '@', '!', 'C@', 'C!', 'H@', 'H!', '+!', '2@', '2!', ',', 'C,', 'ALLOT',
    'ALIGN', 'ALIGNED', 'HERE', 'CELLS', 'CELL+', 'CHARS', 'CHAR+', 'COUNT',
    'FILL', 'MOVE', 'BL', 'TRUE', 'FALSE', 'STATE', 'BASE', '>IN', 'SOURCE',
    'DECIMAL', 'HEX', 'EMIT', 'KEY', 'CR', 'SPACE', 'SPACES', 'TYPE',
    'ACCEPT', '.', 'U.', '<#', '#', '#S', '#>', 'HOLD', 'SIGN', '>NUMBER',
    'WORD', 'CHAR', '[CHAR]', '(', '\\', '.(', 'FIND', "'", "[']", 'EXECUTE',
    'EVALUATE', 'QUIT', 'ABORT', 'ABORT"', 'ENVIRONMENT?', '[', ']', ':', ';',
    'CREATE', 'DOES>', 'VARIABLE', 'CONSTANT', 'IMMEDIATE', '>BODY',
    'LITERAL', 'POSTPONE', 'COMPILE,', 'RECURSE', 'IF', 'ELSE', 'THEN',
    'BEGIN', 'UNTIL', 'AGAIN', 'WHILE', 'REPEAT', 'DO', 'LOOP', '+LOOP', 'I',
    'J', 'LEAVE', 'UNLOOP', 'EXIT', '>R', 'R>', 'R@', '."', 'S"', 'SAVE',
    'EMPTY', 'REBOOT', 'IRQ!', 'EINT', 'DINT', '(DOES>)', '(ABORT")',
)

# copied inline into your words (flag L in src/wordlist.h); the rest are called with BL
INLINE = frozenset((
    'DUP', 'DROP', 'SWAP', 'OVER', 'ROT', 'NIP', '2DROP', '+', '-', '*',
    'NEGATE', '1+', '1-', '2*', '2/', 'LSHIFT', 'RSHIFT', 'AND', 'OR', 'XOR',
    'INVERT', 'S>D', '0=', '0<', '=', '<', '>', 'U<', '<>', '0<>', '@', '!',
    'C@', 'C!', 'H@', 'H!', 'CELLS', 'CELL+', 'CHARS', 'CHAR+',
))
