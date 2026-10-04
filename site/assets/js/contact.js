/* ============================================================================
   SADKO — "تواصل معنا".
   ----------------------------------------------------------------------------
   Four blocks:
     • the two fast lanes — the hotline and the support mailbox;
     • "ماذا تحتاج؟" — a router that sends people to the page that actually
       answers their question instead of making them write a message first;
     • the seven showrooms, straight from showrooms.html (same addresses, same
       numbers, same seasonal note for Marina);
     • a message composer.

   The composer is honest about what it is: this site has no backend and cannot
   submit anything. It builds a mailto: link with the subject and body already
   filled in, and says plainly that pressing it opens the customer's own mail
   app — the message is not sent until they send it. No ticket numbers, no
   "we have received your message", no fake response times.

   Working hours are deliberately absent: showrooms.html does not state them,
   so we tell people to ring the branch rather than invent a schedule.
   ========================================================================== */
(function () {
  'use strict';

  const MAIL = 'csupport@sadko-group.com';
  const TEL = '19140';

  function mountContact(root) {
    const A = window.skApp;
    const t = A.t, esc = A.esc, P = A.P;

    /* ---------------- the seven branches (source: showrooms.html) ---------------- */
    const BRANCHES = [
      { nAr: 'معرض ماسبيرو', nEn: 'Maspero showroom', rAr: 'القاهرة', rEn: 'Cairo',
        aAr: '1123 كورنيش النيل – ماسبيرو', aEn: '1123 Corniche El Nil – Maspero',
        tels: [['0225792070', '02 25792070'], ['0225794647', '02 25794647'], ['01223940358', '0122 394 0358']] },
      { nAr: 'معرض عبد العزيز', nEn: 'Abdel Aziz showroom', rAr: 'القاهرة', rEn: 'Cairo',
        aAr: '7 شارع عبد العزيز – العتبة', aEn: '7 Abdel Aziz Street – Al Ataba',
        tels: [['0223960384', '02 23960384'], ['0223960403', '02 23960403']] },
      { nAr: 'معرض مدينة نصر', nEn: 'Nasr City showroom', rAr: 'القاهرة', rEn: 'Cairo',
        aAr: '91 شارع مصطفى النحاس – مدينة نصر', aEn: '91 Mostafa El Nahhas Street – Nasr City',
        tels: [['0222707072', '02 22707072'], ['0222701790', '02 22701790'], ['01227901770', '0122 790 1770']] },
      { nAr: 'معرض المهندسين', nEn: 'Mohandessin showroom', rAr: 'الجيزة', rEn: 'Giza',
        aAr: '54 شارع شهاب – المهندسين', aEn: '54 Shehab Street – Mohandessin',
        tels: [['0233478974', '02 33478974'], ['0233458648', '02 33458648'], ['01223945203', '0122 394 5203']] },
      { nAr: 'معرض فيصل', nEn: 'Faisal showroom', rAr: 'الجيزة', rEn: 'Giza',
        aAr: '63-65 شارع الملك فيصل – الهرم', aEn: '63-65 King Faisal Street – Haram',
        tels: [['0233862553', '02 33862553'], ['0233862554', '02 33862554'], ['01223982106', '0122 398 2106']] },
      { nAr: 'معرض الإسكندرية', nEn: 'Alexandria showroom', rAr: 'الإسكندرية', rEn: 'Alexandria',
        aAr: '293 شارع بور سعيد – سيدى جابر', aEn: '293 Port Said Street – Sidi Gaber',
        tels: [['035235335', '03 5235335'], ['01223945316', '0122 394 5316']] },
      { nAr: 'معرض مارينا', nEn: 'Marina showroom', rAr: 'الساحل الشمالى، موسمى صيفاً', rEn: 'North Coast, seasonal', season: true,
        aAr: 'محل رقم 1 – منطقة 3 – الساحل الشمالى', aEn: 'Shop no. 1 – Zone 3 – North Coast',
        tels: [['0464060581', '046 4060581'], ['01222143900', '0122 214 3900']] },
    ];

    /* ---------------- "what do you need?" router ---------------- */
    const ROUTES = [
      { hAr: 'نصيحة فى اختيار منتج', hEn: 'Advice on choosing a product',
        pAr: 'أجب عن بضعة أسئلة عن منزلك واستخدامك، وستعود إليك ٣ ترشيحات مكتوب مع كل منها سبب ترشيحه، أسرع من مكالمة.',
        pEn: 'Answer a few questions about your home and how you use it and you get three suggestions, each with the reason it was suggested, faster than a phone call.',
        href: 'finder.html', cAr: 'ساعدنى أختار', cEn: 'Help me choose' },
      { hAr: 'سؤال عن سعر',
        hEn: 'A question about price',
        pAr: 'قبل أن تسأل، قارن سعر المنتج لدى المتاجر المدعومة، فالأسعار مأخوذة من صفحات المنتجات وقد تتغير، فأكّدها قبل الشراء.',
        pEn: 'Before you ask, compare the price across the supported stores. Prices are taken from product pages and can change, so confirm before buying.',
        href: 'compare.html', cAr: 'قارن الأسعار', cEn: 'Compare prices' },
      { hAr: 'ضمان أو صيانة أو شكوى', hEn: 'Warranty, maintenance or a complaint',
        pAr: 'تتضمن صفحة خدمة العملاء إجابات سريعة، وتجهّز لك نص الطلب كاملاً بالطراز وتاريخ الشراء وحالة الضمان لترسله أو تقرأه فى المكالمة.',
        pEn: 'The customer care page has quick answers, and prepares the full request text with model, purchase date and warranty status for you to send or read out on the phone.',
        href: 'care.html', cAr: 'مركز خدمة العملاء', cEn: 'Customer care' },
      { hAr: 'حالة طلب اشتريته', hEn: 'The status of an order',
        pAr: 'الطلبات التى قدّمتها من الموقع محفوظة على جهازك ويمكنك مراجعتها هنا. وإن احتجت تأكيداً رسمياً لحالة طلب، فاتصل بالخط الساخن.',
        pEn: 'Orders you placed on the site are stored on your device and you can review them here. For an official confirmation of an order status, call the hotline.',
        href: 'orders.html', cAr: 'طلباتى', cEn: 'My orders' },
    ];

    /* ---------------- message subjects ---------------- */
    const TOPICS = [
      ['general', 'استفسار عام', 'General enquiry'],
      ['product', 'سؤال عن منتج أو عن توافره', 'A question about a product or its availability'],
      ['price', 'سؤال عن السعر أو التقسيط', 'A question about price or instalments'],
      ['delivery', 'التوصيل أو التركيب', 'Delivery or installation'],
      ['warranty', 'الضمان', 'Warranty'],
      ['service', 'صيانة أو عطل', 'Maintenance or a fault'],
      ['complaint', 'شكوى', 'A complaint'],
      ['partner', 'شراكة أو توريد', 'Partnership or supply'],
    ];
    const topicLabel = v => {
      const r = TOPICS.filter(x => x[0] === v)[0] || TOPICS[0];
      return t(r[1], r[2]);
    };

    /* ================= sections ================= */

    function lanes() {
      return '<section aria-labelledby="ct-fast">' +
        '<h2 class="ct-h" id="ct-fast">' + esc(t('أسرع طريقتين', 'The two fastest ways')) + '</h2>' +
        '<p class="ct-sub">' + esc(t(
          'الهاتف أسرع حين تحتاج رداً فورياً. والبريد الإلكترونى أفضل حين تحتاج إرسال صور أو فاتورة أو رقم طراز مكتوب.',
          'The phone is quicker when you need an answer now. E-mail is better when you need to attach photos, an invoice, or a written model number.')) + '</p>' +
        '<div class="lanes">' +
          '<a class="lane" href="tel:' + TEL + '">' +
            '<span class="k">' + esc(t('الخط الساخن', 'Hotline')) + '</span>' +
            '<b class="ltr">' + TEL + '</b>' +
            '<span class="d">' + esc(t('مكالمة واحدة لكل الفروع وخدمة العملاء. جهّز الطراز وتاريخ الشراء قبل الاتصال، فذلك يوفّر مكالمة كاملة.',
              'One number for all branches and customer care. Have the model and purchase date ready before you call: it saves an entire phone call.')) + '</span>' +
          '</a>' +
          '<a class="lane" href="mailto:' + MAIL + '">' +
            '<span class="k">' + esc(t('بريد خدمة العملاء', 'Customer care e-mail')) + '</span>' +
            '<b class="ltr">' + MAIL + '</b>' +
            '<span class="d">' + esc(t('اذكر فيه الطراز والرقم التسلسلى وأرفق صورة الفاتورة إن توفرت، فذلك يختصر الرد خطوة كاملة.',
              'Include the model and serial number and attach a photo of the invoice if you have one: it cuts a whole step out of the reply.')) + '</span>' +
          '</a>' +
        '</div></section>';
    }

    function router() {
      return '<section class="ct-sec" aria-labelledby="ct-need">' +
        '<h2 class="ct-h" id="ct-need">' + esc(t('ماذا تحتاج؟', 'What do you need?')) + '</h2>' +
        '<p class="ct-sub">' + esc(t(
          'لمعظم الأسئلة إجابة على الموقع دون انتظار رد من أحد. اطّلع على ما يخصك:',
          'Most questions already have an answer on this site without waiting for anyone to reply. Find yours:')) + '</p>' +
        '<ul class="rts">' + ROUTES.map(r =>
          '<li><a class="rt" href="' + P(r.href) + '">' +
            '<h3>' + esc(t(r.hAr, r.hEn)) + '</h3>' +
            '<p>' + esc(t(r.pAr, r.pEn)) + '</p>' +
            '<span class="go">' + esc(t(r.cAr + ' ←', r.cEn + ' →')) + '</span>' +
          '</a></li>').join('') + '</ul></section>';
    }

    function branches() {
      return '<section class="ct-sec" aria-labelledby="ct-brs">' +
        '<h2 class="ct-h" id="ct-brs">' + esc(t('المعارض السبعة', 'The seven showrooms')) + '</h2>' +
        '<p class="ct-sub">' + esc(t(
          'القاهرة الكبرى والجيزة والإسكندرية والساحل الشمالى. ولكل معرض أرقام هاتفه، ويمكنك الاتصال به مباشرةً.',
          'Greater Cairo, Giza, Alexandria and the North Coast. Each showroom has its own numbers, and you can call it directly.')) + '</p>' +
        '<ul class="brs">' + BRANCHES.map(b =>
          '<li class="br">' +
            '<span class="chip ' + (b.season ? 'chip--warn' : 'chip--mute') + '">' + esc(t(b.rAr, b.rEn)) + '</span>' +
            '<h3>' + esc(t(b.nAr, b.nEn)) + '</h3>' +
            '<address>' + esc(t(b.aAr, b.aEn)) + '</address>' +
            '<div class="tels">' + b.tels.map(x =>
              '<a href="tel:' + esc(x[0]) + '" dir="ltr">' + esc(x[1]) + '</a>').join('') + '</div>' +
          '</li>').join('') + '</ul>' +
        '<p class="note note--warn mt16">' + esc(t(
          'مواعيد العمل غير منشورة على الموقع، ولا يصح أن نخمّنها لك، فاتصل بالمعرض نفسه أو بالخط الساخن ' + TEL + ' للتأكد من المواعيد ومن توافر الجهاز قبل التوجه إليه. ويعمل معرض مارينا فى موسم الصيف فقط.',
          'Opening hours are not published on this site and we are not going to guess them for you. Call the branch itself or the hotline ' + TEL + ' to confirm the hours and that the appliance is in stock before making the trip. The Marina showroom operates in the summer season only.')) + '</p>' +
        '<p class="mt16"><a class="btn btn--ghost btn--sm" href="' + P('showrooms.html') + '">' +
          esc(t('صفحة المعارض', 'Showrooms page')) + '</a></p>' +
        '</section>';
    }

    function form() {
      return '<section class="ct-sec panel ct-out" aria-labelledby="ct-msg">' +
        '<h2 class="ct-h" id="ct-msg">' + esc(t('أرسل لنا رسالة', 'Send us a message')) + '</h2>' +
        '<p class="ct-sub">' + esc(t(
          'املأ الحقول وسنجهّز لك الرسالة كاملة بموضوع وبيانات تواصل. ويفتح الزر برنامج البريد لديك والرسالة جاهزة، غير أنها لا تُرسَل إلا عندما تضغط «إرسال» بنفسك.',
          'Fill in the fields and we prepare the whole message for you, with a subject and your contact details. The button opens your own e-mail app with the message ready, but it is not sent until you press send yourself.')) + '</p>' +

        '<p class="note note--warn">' + esc(t(
          'لا إرسال فى هذه الصفحة. فلا يوجد خادم يستقبل الرسالة، ولا يُنشَأ هنا رقم شكوى، ولن يرى ما كتبته أحد إلا حين ترسله من بريدك أو تقرأه فى مكالمة على ' + TEL + '.',
          'This page does not submit anything. There is no server receiving the message, no ticket number is created here, and nobody sees what you wrote until you send it from your own mailbox or read it out on a call to ' + TEL + '.')) + '</p>' +

        '<form id="ct-form" class="mt16" novalidate>' +
          '<div class="row">' +
            '<label class="field"><span class="field__l">' + esc(t('اسمك', 'Your name')) + '</span>' +
              '<input class="input" name="name" id="ct-name" autocomplete="name"></label>' +
            '<label class="field"><span class="field__l">' + esc(t('رقم الهاتف', 'Phone number')) + '</span>' +
              '<input class="input ltr" name="phone" id="ct-phone" inputmode="tel" autocomplete="tel"></label>' +
            '<label class="field"><span class="field__l">' + esc(t('المحافظة / المنطقة', 'Governorate / area')) + '</span>' +
              '<input class="input" name="area" id="ct-area"></label>' +
          '</div>' +

          '<div class="row">' +
            '<label class="field"><span class="field__l">' + esc(t('موضوع الرسالة', 'Message subject')) + '</span>' +
              '<select class="select" name="topic" id="ct-topic">' + TOPICS.map(o =>
                '<option value="' + esc(o[0]) + '">' + esc(t(o[1], o[2])) + '</option>').join('') + '</select></label>' +
            '<label class="field"><span class="field__l">' + esc(t('أقرب معرض إليك', 'Your nearest showroom')) + '</span>' +
              '<select class="select" name="branch" id="ct-branch">' +
                '<option value="">' + esc(t('(غير محدد)', '(not specified)')) + '</option>' +
                BRANCHES.map(b => '<option value="' + esc(t(b.nAr, b.nEn)) + '">' + esc(t(b.nAr, b.nEn)) + '</option>').join('') +
              '</select>' +
              '<span class="field__hint">' + esc(t('اختيارى، يساعد من يرد عليك على تحويلك إلى الفرع الصحيح.',
                'Optional: it helps whoever replies send you to the right branch.')) + '</span></label>' +
          '</div>' +

          '<label class="field"><span class="field__l">' + esc(t('رسالتك', 'Your message')) + '</span>' +
            '<textarea class="textarea" name="message" id="ct-message" rows="6" placeholder="' +
              esc(t('مثلاً: أود معرفة ما إذا كانت ثلاجة كريازى 16 قدماً متوفرة فى معرض المهندسين، وكم سعرها بالتقسيط.',
                'e.g. I would like to know whether the 16 cu ft Kiriazi fridge is available in the Mohandessin showroom, and its instalment price.')) + '"></textarea>' +
            '<span class="field__hint">' + esc(t('ما تكتبه هنا يبقى فى متصفحك، فالصفحة لا تخزّنه ولا ترسله دون علمك.',
              'What you type stays in your browser: this page neither stores it nor sends it behind your back.')) + '</span></label>' +

          '<label class="field mt16"><span class="field__l">' + esc(t('معاينة الرسالة', 'Message preview')) + '</span>' +
            '<textarea class="textarea" id="ct-preview" readonly rows="10"></textarea>' +
            '<span class="field__hint" id="ct-hint"></span></label>' +

          '<div class="row mt16">' +
            '<a class="btn btn--primary" id="ct-mailto" href="mailto:' + MAIL + '" style="flex:0 1 auto">' +
              esc(t('افتح بريدى بهذه الرسالة', 'Open my e-mail with this message')) + '</a>' +
            '<button type="button" class="btn btn--ghost" id="ct-copy" style="flex:0 1 auto">' +
              esc(t('انسخ نص الرسالة', 'Copy the message text')) + '</button>' +
            '<a class="btn btn--teal" href="tel:' + TEL + '" dir="ltr" style="flex:0 1 auto">' +
              esc(t('اتصل على ' + TEL, 'Call ' + TEL)) + '</a>' +
          '</div>' +
          '<p class="small muted mt16" id="ct-status" role="status">' + esc(t(
            'ستُرسَل الرسالة إلى ' + MAIL + '. وإن لم يفتح الزر برنامج بريد على جهازك، فانسخ النص وأرسله من البريد الذى تستخدمه.',
            'The message goes to ' + MAIL + '. If the button does not open a mail app on your device, copy the text and send it from whichever e-mail you use.')) + '</p>' +
        '</form></section>';
    }

    /* ================= the message itself ================= */

    function read() {
      const g = id => { const el = root.querySelector('#' + id); return el ? String(el.value || '').trim() : ''; };
      return { name: g('ct-name'), phone: g('ct-phone'), area: g('ct-area'),
               topic: g('ct-topic'), branch: g('ct-branch'), message: g('ct-message') };
    }

    function buildSubject(v) {
      const s = t('رسالة من موقع صادكو: ', 'Message from the SADKO website: ') + topicLabel(v.topic || 'general');
      return v.name ? s + ' (' + v.name + ')' : s;
    }

    function buildBody(v) {
      const L = [];
      const line = (k, val) => { if (val) L.push(k + ': ' + val); };
      L.push(t('رسالة كُتبت من صفحة «تواصل معنا» على موقع صادكو.',
               'A message written on the "Contact us" page of the SADKO website.'));
      L.push('');
      line(t('الموضوع', 'Subject'), topicLabel(v.topic || 'general'));
      line(t('الاسم', 'Name'), v.name);
      line(t('الهاتف', 'Phone'), v.phone);
      line(t('المحافظة / المنطقة', 'Governorate / area'), v.area);
      line(t('أقرب معرض', 'Nearest showroom'), v.branch);
      L.push('');
      L.push(t('الرسالة:', 'Message:'));
      L.push(v.message || t('(لم تُكتب بعد)', '(not written yet)'));
      L.push('');
      L.push(t('كُتبت فى: ', 'Written on: ') + A.date(new Date()));
      return L.join('\n');
    }

    function sync() {
      const v = read();
      const subject = buildSubject(v), body = buildBody(v);
      const a = root.querySelector('#ct-mailto');
      const pre = root.querySelector('#ct-preview');
      const hint = root.querySelector('#ct-hint');
      if (a) a.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      if (pre) pre.value = body;
      if (hint) hint.textContent = v.message
        ? t('هذا بالضبط ما سيُفتح فى برنامج البريد لديك، ولا يزال بإمكانك تعديله قبل الإرسال.',
            'This is exactly what will open in your mail app, and you can still edit it before sending.')
        : t('اكتب رسالتك أعلاه لتظهر هنا. والزر يعمل بدونها، غير أن الرسالة ستصل فارغة.',
            'Type your message above and it will appear here. The button works without it, but the message would arrive empty.');
      return { subject: subject, body: body };
    }

    /* ================= events ================= */

    root.innerHTML = lanes() + router() + branches() + form();

    root.addEventListener('input', e => { if (e.target.closest('#ct-form')) sync(); });
    root.addEventListener('change', e => { if (e.target.closest('#ct-form')) sync(); });
    root.addEventListener('submit', e => {
      if (!e.target.matches('#ct-form')) return;
      e.preventDefault();               // there is nothing to submit to
      sync();
      const a = root.querySelector('#ct-mailto');
      if (a) a.focus();
    });

    root.addEventListener('click', e => {
      const b = e.target.closest('#ct-copy');
      if (!b) return;
      const box = root.querySelector('#ct-preview');
      const status = root.querySelector('#ct-status');
      if (!box) return;
      const say = ok => { if (status) status.textContent = ok
        ? t('تم النسخ. الصقه فى بريدك أو فى واتساب، وتذكّر أنه لم يُرسَل بعد.',
            'Copied. Paste it into your e-mail or messaging app, and remember it is still not sent.')
        : t('لم يسمح المتصفح بالنسخ التلقائى. حدّد النص من صندوق المعاينة وانسخه بنفسك.',
            'The browser refused automatic copying. Select the text in the preview box and copy it yourself.'); };
      let handled = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          handled = true;
          navigator.clipboard.writeText(box.value).then(() => say(true), () => say(false));
        }
      } catch (err) { handled = false; }
      if (!handled) {
        try { box.focus(); box.select(); say(!!document.execCommand('copy')); }
        catch (err2) { say(false); }
      }
    });

    sync();
  }

  window.mountContact = mountContact;
})();
