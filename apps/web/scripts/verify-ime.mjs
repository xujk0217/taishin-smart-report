/**
 * Verifies IME-safe Enter detection.
 * Mirrors isComposingEnter from src/utils/ime.ts.
 */

function isComposingEnter(e, composingFlag = false) {
  return Boolean(e.nativeEvent?.isComposing) || e.keyCode === 229 || composingFlag;
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const evt = (opts = {}) => ({
  key: 'Enter',
  keyCode: opts.keyCode ?? 13,
  nativeEvent: { isComposing: opts.isComposing ?? false },
});

// ── Should BLOCK submission (IME is composing) ──
check('blocks when isComposing is true',
  isComposingEnter(evt({ isComposing: true })) === true);

check('blocks when keyCode is 229 (legacy IME)',
  isComposingEnter(evt({ keyCode: 229 })) === true);

check('blocks when tracked composing flag is set',
  isComposingEnter(evt(), true) === true);

check('blocks when isComposing cleared early but flag still set',
  isComposingEnter(evt({ isComposing: false }), true) === true);

// ── Should ALLOW submission (plain Enter) ──
check('allows plain Enter with no IME',
  isComposingEnter(evt()) === false);

check('allows Enter after composition fully ended',
  isComposingEnter(evt({ isComposing: false }), false) === false);

// ── Missing nativeEvent must not throw ──
{
  let threw = false;
  try {
    isComposingEnter({ key: 'Enter', keyCode: 13 });
  } catch { threw = true; }
  check('tolerates missing nativeEvent', !threw);
}

// ── Realistic Chinese input sequence ──
// User types pinyin, IME shows candidates, first Enter picks the word,
// second Enter should submit.
{
  let submitted = 0;
  let composing = false;

  const onCompositionStart = () => { composing = true; };
  const onCompositionEnd = () => { composing = false; };
  const onKeyDown = e => {
    if (e.key !== 'Enter') return;
    if (isComposingEnter(e, composing)) return;
    submitted++;
  };

  onCompositionStart();                              // start typing 「ㄊㄞˊ」
  onKeyDown(evt({ isComposing: true }));             // Enter picks 「台」
  check('first Enter during composition does not submit', submitted === 0);

  onCompositionEnd();                                // candidate committed
  onKeyDown(evt());                                  // Enter again
  check('Enter after composition ends submits', submitted === 1);
}

// ── Chrome quirk: compositionend fires before keydown ──
{
  let submitted = 0;
  let composing = false;
  const onKeyDown = e => {
    if (e.key !== 'Enter') return;
    if (isComposingEnter(e, composing)) return;
    submitted++;
  };

  composing = true;
  // compositionend arrives, but the deferred reset has not run yet
  onKeyDown(evt({ isComposing: false }));
  check('deferred flag reset prevents accidental submit', submitted === 0);

  composing = false; // setTimeout(0) has now run
  onKeyDown(evt());
  check('submits on the next Enter', submitted === 1);
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
