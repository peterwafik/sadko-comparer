/* ============================================================================
   Admin sign-in screens (engine/admin-auth.mjs does the deciding):

     email + password ─┬─ temporary password → new password → authenticator → in
                       └─ returning admin   → 6-digit code               → in

   Each screen only knows the stage the server says the session is in. A
   reload lands on the right screen; a session that ended starts over.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.ADM, t = A.t, esc = A.esc;

  function card(stepIdx, inner) {
    const steps = stepIdx == null ? '' : '<div class="auth__steps">' + [0, 1, 2].map(i => '<i class="' + (i <= stepIdx ? 'on' : '') + '"></i>').join('') + '</div>';
    document.getElementById('root').innerHTML =
      '<div class="auth"><div class="auth__card"><div class="auth__brand"><img src="assets/img/sadko-logo-256.webp" alt=""><div><b>' +
      t('صادكو جروب', 'SADKO Group') + '</b><span>' + t('بوابة الإدارة', 'Admin portal') + '</span></div></div>' + steps + inner +
      '<div class="auth__foot"><span class="muted">' + t('للمسؤولين فقط', 'Administrators only') + '</span>' +
      '<button class="btn btn--quiet btn--sm" id="authLang">' + (A.EN() ? 'العربية' : 'English') + '</button></div></div></div>';
    document.getElementById('authLang').onclick = () => { A.setLang(A.EN() ? 'ar' : 'en'); start(LAST); };
  }
  const err = (box, msg) => { box.innerHTML = msg ? '<div class="note note--bad" style="margin-bottom:12px">' + esc(msg) + '</div>' : ''; };
  async function submit(form, fn) {
    const btn = form.querySelector('button[type=submit]');
    const old = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spin spin--sm"></span>';
    try { await fn(); } finally { if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = old; } }
  }
  /* Where a successful step leads. */
  function next(r) {
    if (!r.ok) return false;
    if (r.stage === 'full') { A.setMe({ email: r.email }); A.shell(); return true; }
    start({ stage: r.stage, email: r.email });
    return true;
  }

  let LAST = { stage: null };
  function start(s) {
    LAST = s || { stage: null };
    A.applyLang();
    if (LAST.stage === 'reset') return resetScreen();
    if (LAST.stage === 'enroll') return enrollScreen();
    if (LAST.stage === 'totp') return totpScreen();
    return loginScreen();
  }

  function loginScreen() {
    card(null, '<h1>' + t('تسجيل الدخول', 'Sign in') + '</h1><p class="lead">' +
      t('ادخل ببريدك وكلمة المرور. أول مرة؟ استخدم كلمة المرور المؤقتة التى وصلتك.', 'Use your email and password. First time? Use the temporary password you were given.') + '</p>' +
      '<form id="f" autocomplete="on"><div id="e"></div>' +
      A.field(t('البريد الإلكترونى', 'Email'), '<input class="input ltr" type="email" name="email" required autocomplete="username" dir="ltr">') +
      A.field(t('كلمة المرور', 'Password'), '<input class="input ltr" type="password" name="password" required autocomplete="current-password" dir="ltr">') +
      '<button class="btn btn--block" type="submit">' + t('دخول', 'Sign in') + '</button></form>');
    const f = document.getElementById('f');
    f.onsubmit = e => {
      e.preventDefault();
      submit(f, async () => {
        const r = await A.auth('POST', 'login', A.formData(f));
        if (!next(r)) err(document.getElementById('e'), r.message);
      });
    };
  }

  function resetScreen() {
    card(0, '<h1>' + t('اختر كلمة مرور جديدة', 'Choose a new password') + '</h1><p class="lead">' +
      t('كلمة المرور المؤقتة تُستخدم مرة واحدة فقط. اختر كلمة مرور خاصة بك.', 'The temporary password works only once. Choose your own.') + '</p>' +
      '<form id="f"><div id="e"></div>' +
      A.field(t('كلمة المرور الجديدة', 'New password'), '<input class="input ltr" type="password" name="password" required minlength="12" autocomplete="new-password" dir="ltr">',
        t('١٢ حرفاً على الأقل. جملة قصيرة تتذكرها أفضل من كلمة معقدة.', 'At least 12 characters. A short phrase you will remember beats a complicated word.')) +
      A.field(t('أعد كتابتها', 'Type it again'), '<input class="input ltr" type="password" name="again" required autocomplete="new-password" dir="ltr">') +
      '<button class="btn btn--block" type="submit">' + t('حفظ ومتابعة', 'Save and continue') + '</button></form>');
    const f = document.getElementById('f');
    f.onsubmit = e => {
      e.preventDefault();
      const d = A.formData(f);
      if (d.password !== d.again) return err(document.getElementById('e'), t('الكلمتان غير متطابقتين.', 'The two passwords do not match.'));
      submit(f, async () => {
        const r = await A.auth('POST', 'reset', { password: d.password });
        if (!next(r)) err(document.getElementById('e'), r.message);
      });
    };
  }

  async function enrollScreen() {
    card(1, '<div class="loading" style="min-height:220px"><span class="spin"></span></div>');
    const s = await A.auth('POST', 'enroll/start', {});
    if (!s.ok) { LAST = { stage: null }; return loginScreen(); }
    card(1, '<h1>' + t('فعّل التحقق بخطوتين', 'Turn on two-step sign-in') + '</h1><p class="lead">' +
      t('افتح تطبيق المصادقة (Google Authenticator أو Microsoft Authenticator) وامسح الرمز، ثم اكتب الكود الظاهر فيه.',
        'Open an authenticator app (Google Authenticator or Microsoft Authenticator), scan the code, then type the 6 digits it shows.') + '</p>' +
      '<div class="qr"><img src="' + s.qr + '" alt="QR"><div><div class="small muted">' + t('لا تستطيع المسح؟ اكتب هذا المفتاح فى التطبيق:', 'Cannot scan? Type this key into the app:') +
      '</div><code>' + esc(s.key) + '</code></div></div>' +
      '<form id="f"><div id="e"></div>' +
      A.field(t('الكود من التطبيق', 'Code from the app'), '<input class="input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>') +
      '<button class="btn btn--block" type="submit">' + t('تفعيل والدخول', 'Turn on and sign in') + '</button></form>');
    codeForm('enroll/confirm');
  }

  function totpScreen() {
    card(null, '<h1>' + t('كود التحقق', 'Verification code') + '</h1><p class="lead">' +
      t('اكتب الكود المكوّن من ٦ أرقام من تطبيق المصادقة.', 'Enter the 6-digit code from your authenticator app.') + '</p>' +
      '<form id="f"><div id="e"></div>' +
      A.field(t('الكود', 'Code'), '<input class="input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>') +
      '<button class="btn btn--block" type="submit">' + t('تحقق', 'Verify') + '</button></form>' +
      '<p class="small muted" style="margin:12px 0 0">' + t('فقدت هاتفك؟ اطلب من مسؤول آخر إعادة دعوتك.', 'Lost your phone? Ask another admin to re-invite you.') + '</p>');
    codeForm('totp');
  }

  function codeForm(step) {
    const f = document.getElementById('f');
    const inp = f.querySelector('input[name=code]');
    inp.focus();
    inp.oninput = () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 6);
      if (inp.value.length === 6) f.requestSubmit();
    };
    f.onsubmit = e => {
      e.preventDefault();
      submit(f, async () => {
        const r = await A.auth('POST', step, { code: inp.value });
        if (next(r)) return;
        err(document.getElementById('e'), r.message);
        inp.value = ''; inp.focus();
        if (r.error === 'no-session' || r.error === 'wrong-stage') setTimeout(() => start({ stage: null }), 1500);
      });
    };
  }

  A.login = { start };
})();
