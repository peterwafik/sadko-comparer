/* ============================================================================
   SADKO — "مركز خدمة العملاء": honest customer care for a site with no backend.
   ----------------------------------------------------------------------------
   Two halves:
     • topic sections — short, straight answers with links to the page that
       actually helps, plus the phone number and the support mailbox;
     • a guided request builder — five questions that end in a formatted request
       the customer can SEND themselves.

   The hard rule here: nothing is submitted. There is no server, so we never
   show a ticket number, a queue position or a "we received your request"
   timeline. What we produce is a text the customer copies, e-mails or reads out
   on the phone — and the UI says, in the same breath, that it is not sent until
   they send it.

   ?ref=<applianceId> pulls the appliance out of skStore.owned so the model,
   purchase date and warranty state are filled in automatically.
   ========================================================================== */
(function () {
  'use strict';

  const MAIL = 'csupport@sadko-group.com';
  const TEL = '19140';

  function mountCare(root) {
    const A = window.skApp, S = window.skStore, O = S.owned;
    const t = A.t, esc = A.esc, num = A.num;
    /* nav.js can switch pages off for a release (skFeature); while "My
       appliances" is off this page neither reads it nor sends people to it. */
    const F = window.skFeature, COMPARE = !F || F.on('compare'), MINE = !F || F.on('appliances');

    const ref = MINE ? A.qs('ref', '') : '';
    const refApp = ref ? O.get(ref) : null;
    const isExternal = a => String(a.seller || 'sadko') !== 'sadko';
    const sellerName = a => (a.sellerName ? a.sellerName : t('متجر آخر', 'another shop'));

    const state = {
      stage: refApp ? 'after' : '',
      source: refApp ? (isExternal(refApp) ? 'other' : 'sadko') : '',
      deviceId: refApp ? refApp.id : '',
      deviceText: '', issue: '', installed: '', contact: '',
      name: '', phone: '', area: '', detail: '',
      out: null, copied: '',
    };

    /* ================= topic sections ================= */
    const TOPICS = [
      { id: 'choose', ar: 'اختيار منتج', en: 'Choosing a product',
        aAr: 'إن لم تكن تعرف ماذا تختار، فأجب عن بضعة أسئلة عن منزلك وعدد الأفراد والمساحة، وسنرشّح لك ٣ خيارات مكتوب مع كل منها سبب ترشيحه.' + (COMPARE ? ' ويمكنك مقارنة الأسعار قبل أن تقرر.' : ''),
        aEn: 'If you are not sure what to buy, answer a few questions about your home, household size and space, and we will suggest three options, each with the reason it was suggested.' + (COMPARE ? ' You can also compare prices before deciding.' : ''),
        links: [['ساعدنى أختار', 'Help me choose', 'finder.html'], ['قارن الأسعار', 'Compare prices', 'compare.html'], ['دليلك للاختيار', 'Buying guides', 'guides.html']] },

      { id: 'delivery', ar: 'التوصيل والتركيب', en: 'Delivery & installation',
        aAr: 'شروط التوصيل والتركيب مكتوبة فى وصف كل منتج، وتختلف من منتج إلى آخر ومن محافظة إلى أخرى، والتركيب فى أنواع كثيرة (تكييف، سخان، غسالة أطباق) يتم بموعد منفصل بعد التوصيل. وأدق مصدر هو صفحة المنتج نفسها، وإن احتجت تأكيداً لطلب بعينه فاتصل بنا على ' + TEL + '.',
        aEn: 'Delivery and installation terms are written on each product page and differ by product and governorate. For many types (air conditioners, water heaters, dishwashers) installation is a separate appointment after delivery. The product page is the most accurate source; for a specific order call ' + TEL + '.',
        links: [['المعارض والفروع', 'Showrooms', 'showrooms.html'], ['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL]] },

      { id: 'warranty', ar: 'الضمان', en: 'Warranty',
        aAr: 'يبدأ الضمان من تاريخ الشراء ومدته مكتوبة فى بطاقة الضمان أو الفاتورة.' + (MINE ? ' سجّل الجهاز فى صفحة «أجهزتى» لنحسب لك الأيام المتبقية ونذكّرك قبل انتهائه بشهر.' : ' احتفظ بهما معاً فى مكان واحد.') + ' ومهم أن تعلم: الضمان يقدمه البائع المذكور فى الفاتورة، فإن اشتريت من متجر آخر، فالضمان يخصه هو.',
        aEn: 'Warranty runs from the purchase date and its length is written on the warranty card or invoice.' + (MINE ? ' Record the appliance under "My appliances" and we will show how many days are left and remind you a month before it ends.' : ' Keep the two together in one place.') + ' Important: the warranty is provided by the seller named on the invoice. If you bought elsewhere, that seller carries it.',
        links: [['أجهزتى والضمان', 'My appliances & warranty', 'appliances.html'], ['الضمان والاسترجاع', 'Warranty & returns', 'warranty.html']] },

      { id: 'usage', ar: 'استخدام الجهاز', en: 'Using the appliance',
        aAr: 'معظم المشكلات التى تصلنا (تبريد ضعيف، غسالة لا تُصرّف، صوت مرتفع) سببها ضبط أو تنظيف بسيط لا عطل. راجع دليل الجهاز أولاً، ثم جرّب الخطوات السريعة الواردة فى أدلة الاستخدام، فإن بقيت المشكلة، فاملأ الطلب أدناه.',
        aEn: 'Most of what reaches us (weak cooling, a washer that will not drain, loud noise) turns out to be a setting or a clean, not a fault. Check the manual first, then the quick steps in our guides, and if it persists, fill in the request below.',
        links: [['أدلة الاستخدام', 'Guides', 'guides.html']] },

      { id: 'maint', ar: 'الصيانة', en: 'Maintenance',
        aAr: 'إن احتاج الجهاز إلى فنى، فجهّز الطراز والرقم التسلسلى وتاريخ الشراء قبل الاتصال، فذلك يوفّر مكالمة كاملة.' + (MINE ? ' وتحفظ صفحة «أجهزتى» هذه البيانات وتذكّرك بمواعيد الصيانة الدورية (فلتر التكييف كل ٣ أشهر مثلاً).' : ''),
        aEn: 'If the appliance needs a technician, have the model, serial number and purchase date ready before you call. It saves an entire phone call.' + (MINE ? ' "My appliances" stores these and reminds you about routine maintenance (an AC filter every three months, for example).' : ''),
        links: [['أجهزتى', 'My appliances', 'appliances.html'], ['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL]] },

      { id: 'returns', ar: 'الاسترجاع والاستبدال', en: 'Returns & exchange',
        aAr: 'يتم الاسترجاع والاستبدال مع البائع الذى اشتريت منه، ويكون أيسر كثيراً والعبوة والفاتورة لديك. ولا يستطيع هذا الموقع بدء عملية استرجاع تلقائياً، بل عليك الاتصال بخدمة العملاء أو التوجه إلى المعرض.',
        aEn: 'Returns and exchanges are handled by the seller you bought from, and go far more smoothly with the box and the invoice. This site cannot start a return automatically: you need to contact customer care or visit the showroom.',
        links: [['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL], ['أرسل بريداً إلكترونياً', 'Send an e-mail', 'mailto:' + MAIL]] },

      { id: 'follow', ar: 'متابعة شكوى', en: 'Following up a complaint',
        aAr: 'لا يوجد نظام متابعة عبر الإنترنت على هذا الموقع، ولا يصح أن نوهمك بوجوده. وحين ترسل طلبك بالبريد الإلكترونى أو تتصل، اسأل عن رقم الطلب واحتفظ به، واحتفظ بنسخة من الرسالة التى أرسلتها، فهى أقوى ما لديك إن تأخرت المتابعة.',
        aEn: 'There is no online tracking system on this site, and we are not going to pretend otherwise. When you e-mail or call, ask for a reference number and keep it, and keep a copy of the message you sent. That is the strongest record you can hold.',
        links: [] },

      { id: 'contact', ar: 'تواصل مع صادكو', en: 'Contact SADKO',
        aAr: 'الهاتف ' + TEL + ' هو أسرع وسيلة، والبريد الإلكترونى ' + MAIL + ' أفضل حين تحتاج إرسال صور أو فاتورة. وهناك المعارض إن أردت رؤية الجهاز بنفسك أو تسليمه بيدك.',
        aEn: 'The phone line ' + TEL + ' is fastest; e-mail ' + MAIL + ' is better when you need to attach photos or an invoice. Showrooms are there if you would rather see the appliance in person.',
        links: [['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL], ['أرسل بريداً إلكترونياً', 'Send an e-mail', 'mailto:' + MAIL], ['المعارض', 'Showrooms', 'showrooms.html']] },
    ];

    /* ================= issue options, per stage ================= */
    const ISSUES_BEFORE = [
      ['advice', 'لا أعرف ماذا أختار', 'I cannot decide what to buy'],
      ['stock', 'هل هو متاح فى المعرض؟', 'Is it available in the showroom?'],
      ['price', 'سؤال عن السعر أو التقسيط', 'A question about price or instalments'],
      ['install-pre', 'سؤال عن التوصيل أو التركيب قبل الشراء', 'A delivery or installation question before buying'],
      ['specs', 'سؤال عن المواصفات أو المقاسات', 'A question about specifications or measurements'],
    ];
    const ISSUES_AFTER = [
      ['fault', 'بالجهاز عطل أو لا يعمل على نحو صحيح', 'The appliance is faulty or not working properly'],
      ['install', 'مشكلة فى التركيب أو حاجة إلى تركيب', 'An installation problem, or I need installation'],
      ['warranty', 'سؤال عن الضمان', 'A warranty question'],
      ['parts', 'أحتاج قطعة غيار أو ملحقاً', 'I need a spare part or accessory'],
      ['return', 'استرجاع أو استبدال', 'Return or exchange'],
      ['howto', 'لا أعرف كيف أستخدمه', 'I do not understand how to use it'],
      ['complaint', 'شكوى من الخدمة', 'A complaint about the service'],
    ];
    const CONTACTS = [
      ['phone', 'مكالمة هاتفية', 'A phone call'],
      ['chat', 'رسالة مكتوبة', 'A written message'],
      ['visit', 'زيارة فنى إلى المنزل', 'A technician visit at home'],
      ['showroom', 'أمرّ على المعرض', 'I will visit the showroom'],
    ];
    const INSTALLED = [
      ['yes', 'نعم، رُكّب', 'Yes, it was installed'],
      ['no', 'لا، لم يُركّب بعد', 'No, not yet'],
      ['na', 'هذا الجهاز لا يحتاج تركيباً', 'This appliance does not need installation'],
      ['self', 'ركّبته بنفسى أو ركّبه شخص من خارج الشركة', 'I installed it myself or someone else did'],
    ];
    const label = (rows, v) => { const r = rows.filter(x => x[0] === v)[0]; return r ? t(r[1], r[2]) : ''; };

    /* ================= render ================= */

    function render() {
      root.innerHTML = topicsSection() + formSection() + (state.out ? outSection() : '');
    }

    function topicsSection() {
      return '<section aria-labelledby="tp-h"><h2 class="panel__h" id="tp-h" style="font-size:1.25rem">' +
        t('إجابات سريعة', 'Quick answers') + '</h2>' +
        '<p class="muted small" style="margin:2px 0 14px">' +
        t('إن كان سؤالك من هذه الأسئلة، فالإجابة هنا مباشرةً دون انتظار أحد.',
          'If your question is one of these, the answer is right here, no waiting.') + '</p>' +
        '<div class="grid2">' + TOPICS.map(tp =>
          '<div class="panel"><h3 class="panel__h">' + esc(t(tp.ar, tp.en)) + '</h3>' +
          '<p class="panel__sub" style="margin-bottom:12px">' + esc(t(tp.aAr, tp.aEn)) + '</p>' +
          (tp.links.length ? '<div class="chips">' + tp.links.map(l =>
            '<a class="chip" href="' + esc(l[2]) + '"' + (/^tel:|^mailto:/.test(l[2]) ? ' dir="ltr"' : '') + '>' +
            esc(t(l[0], l[1])) + '</a>').join('') + '</div>' : '') +
          '</div>').join('') + '</div></section>';
    }

    function formSection() {
      const owned = MINE ? O.all() : [];
      const issues = state.stage === 'before' ? ISSUES_BEFORE : ISSUES_AFTER;
      return '<section class="panel mt24" aria-labelledby="gf-h"><h2 class="panel__h" id="gf-h" style="font-size:1.25rem">' +
        t('طلب مساعدة موجّه', 'Guided support request') + '</h2>' +
        '<p class="panel__sub">' + t('خمسة أسئلة، ثم نجهّز لك نص الطلب كاملاً لترسله بنفسك بالبريد الإلكترونى أو تقرأه فى المكالمة. ولا يُرسَل شىء من هذه الصفحة.',
          'Five questions, then we prepare the full request text for you to send yourself by e-mail or read out on the phone. Nothing is sent from this page.') + '</p>' +
        (refApp ? refBlock() : '') +
        '<form id="care-form" novalidate>' +
          step(1, t('أقبل الشراء أم بعده؟', 'Before buying, or after?'),
            opts('stage', [['before', 'قبل الشراء', 'Before buying'], ['after', 'بعد الشراء', 'After buying']], state.stage)) +

          step(2, t('أى جهاز أو طلب؟', 'Which appliance or request?'),
            (owned.length
              ? '<label class="field"><span class="field__l small">' + t('من أجهزتى المسجَّلة', 'From my recorded appliances') + '</span>' +
                '<select class="select" name="deviceId"><option value="">' + t('(ليس من القائمة)', '(not from the list)') + '</option>' +
                owned.map(a => '<option value="' + esc(a.id) + '"' + (state.deviceId === a.id ? ' selected' : '') + '>' +
                  esc(a.title || t('جهاز بدون اسم', 'Untitled appliance')) + '</option>').join('') + '</select></label>'
              : !MINE ? '' : '<p class="small muted">' + t('إن سجّلت أجهزتك فى صفحة «أجهزتى» ظهرت هنا وامتلأت تلقائياً. ',
                  'If you record your appliances under "My appliances" they will appear here and fill themselves in. ') +
                '<a href="appliances.html">' + t('سجّل جهازك', 'Record an appliance') + '</a></p>') +
            '<label class="field"><span class="field__l small">' + t('أو اكتب الجهاز / الطلب', 'Or type the appliance / request') + '</span>' +
              '<input class="input" name="deviceText" value="' + esc(state.deviceText) + '" placeholder="' +
              t('مثلاً: تكييف شارب ٢٫٢٥ حصان', 'e.g. Sharp 2.25 HP air conditioner') + '"></label>' +
            '<div class="field"><span class="field__l small">' + t('من أين اشتريته؟', 'Where did you buy it?') + '</span>' +
              opts('source', [['sadko', 'من صادكو', 'From SADKO'], ['other', 'من متجر آخر', 'From another shop'], ['none', 'لم أشترِه بعد', 'I have not bought it yet']], state.source) +
            '</div>' +
            (state.source === 'other' ? '<p class="note note--warn small">' +
              t('إن كان الجهاز قد اشتُرى من متجر آخر: فالضمان والاسترجاع والتركيب مسؤولية ذلك البائع لا صادكو، فاتصل به أولاً. ويظل بإمكانك أن تسألنا نصيحة فنية أو عن قطع غيار متوفرة لدينا.',
                'If it was bought from another shop: warranty, returns and installation are that seller\'s responsibility, not SADKO\'s. Contact them first. You are still welcome to ask us for technical advice or about parts we stock.') + '</p>' : '')) +

          step(3, t('ما نوع المشكلة أو الطلب؟', 'What kind of problem or request?'),
            state.stage ? opts('issue', issues, state.issue)
              : '<p class="small muted">' + t('أجب عن السؤال الأول أولاً لنعرض الخيارات المناسبة.',
                  'Answer the first question so we can show the relevant options.') + '</p>') +

          step(4, t('هل تم التركيب؟', 'Has it been installed?'),
            opts('installed', INSTALLED, state.installed) +
            '<span class="field__hint">' + t('وهذا مهم لأن مشكلات كثيرة (تبريد ضعيف، تسريب مياه، اهتزاز) سببها تركيب غير مضبوط لا عطل فى الجهاز.',
              'This matters because many problems (weak cooling, leaks, vibration) come from incorrect installation rather than a fault.') + '</span>') +

          step(5, t('كيف تفضّل أن نتواصل معك؟', 'How would you rather be contacted?'),
            opts('contact', CONTACTS, state.contact) +
            (state.contact === 'chat' ? '<p class="note note--info small">' +
              t('لا توجد محادثة مباشرة على هذا الموقع. و«رسالة مكتوبة» تعنى بريداً إلكترونياً على ' + MAIL + '، وهو مناسب حين تحتاج إرسال صور أو الفاتورة.',
                'There is no live chat on this site. "A written message" means an e-mail to ' + MAIL + ', good when you need to attach photos or the invoice.') + '</p>' : '') +
            (state.contact === 'visit' ? '<p class="note note--info small">' +
              t('تُحدَّد زيارة الفنى بموعد من خدمة العملاء بعد إرسال الطلب، وهذه الصفحة لا تحجز موعداً.',
                'A technician visit is scheduled by customer care after you send the request. This page does not book appointments.') + '</p>' : '') +
            '<div class="row mt8">' +
              '<label class="field"><span class="field__l small">' + t('اسمك', 'Your name') + '</span>' +
                '<input class="input" name="name" value="' + esc(state.name) + '" autocomplete="name"></label>' +
              '<label class="field"><span class="field__l small">' + t('رقم الهاتف', 'Phone number') + '</span>' +
                '<input class="input ltr" name="phone" value="' + esc(state.phone) + '" inputmode="tel" autocomplete="tel"></label>' +
              '<label class="field"><span class="field__l small">' + t('المحافظة / المنطقة', 'Governorate / area') + '</span>' +
                '<input class="input" name="area" value="' + esc(state.area) + '"></label>' +
            '</div>' +
            '<label class="field"><span class="field__l small">' + t('اشرح المشكلة بكلماتك', 'Describe it in your own words') + '</span>' +
              '<textarea class="textarea" name="detail" placeholder="' +
              t('مثلاً: التكييف يعمل لكن التبريد ضعيف منذ أسبوع، وقد نظّفت الفلتر دون فرق.',
                'e.g. the AC runs but cooling has been weak for a week; I cleaned the filter and it made no difference.') +
              '">' + esc(state.detail) + '</textarea>' +
              '<span class="field__hint">' + t('تبقى هذه البيانات فى المتصفح إلى أن ترسلها بنفسك، فلا شىء يُخزَّن ولا يُرسَل دون أن تفعل ذلك أنت.',
                'What you type stays in your browser until you send it yourself: nothing is stored or transmitted without you doing it.') + '</span></label>') +

          '<div class="row mt16"><button type="submit" class="btn btn--primary">' + t('جهّز نص الطلب', 'Prepare my request') + '</button>' +
            '<a class="btn btn--ghost" href="tel:' + TEL + '" dir="ltr">' + t('أو اتصل على ' + TEL, 'Or call ' + TEL) + '</a></div>' +
        '</form></section>';
    }

    function step(n, title, body) {
      return '<fieldset class="field mt16" style="border:0;padding:0;margin-inline:0">' +
        '<legend class="field__l" style="font-size:1rem">' + num(n) + '. ' + esc(title) + '</legend>' + body + '</fieldset>';
    }
    function opts(name, rows, val) {
      return '<div class="opts">' + rows.map(r =>
        '<label class="opt"><input type="radio" name="' + name + '" value="' + esc(r[0]) + '"' + (val === r[0] ? ' checked' : '') + '>' +
        '<span>' + esc(t(r[1], r[2])) + '</span></label>').join('') + '</div>';
    }

    /* the appliance the customer arrived with (?ref=) */
    function refBlock() {
      const a = refApp;
      const dl = O.daysLeft(a), end = O.warrantyEnd(a);
      const w = !a.purchaseDate ? { c: 'chip--mute', s: t('تاريخ الشراء ناقص', 'Purchase date missing') }
        : dl == null ? { c: 'chip--mute', s: t('مدة الضمان غير مسجَّلة', 'Warranty length not recorded') }
        : dl <= 0 ? { c: 'chip--bad', s: t('الضمان انتهى', 'Warranty expired') }
        : dl < 60 ? { c: 'chip--warn', s: t('الضمان يوشك على الانتهاء، بقى ' + num(dl) + ' يوم', 'Ending soon: ' + num(dl) + ' days left') }
        : { c: 'chip--ok', s: t('الضمان سارٍ، بقى ' + num(dl) + ' يوم', 'In warranty: ' + num(dl) + ' days left') };
      return '<div class="note note--info mt16"><strong>' + t('هذا الطلب بشأن: ', 'This request is about: ') + '</strong>' +
        esc(a.title || t('جهاز بدون اسم', 'Untitled appliance')) +
        '<ul class="specs mt8">' +
          '<li><span class="k">' + t('الطراز', 'Model') + '</span><span class="v' + (a.model ? ' ltr' : ' unknown') + '">' + esc(a.model || t('غير مسجَّل', 'not recorded')) + '</span></li>' +
          '<li><span class="k">' + t('الرقم التسلسلى', 'Serial number') + '</span><span class="v' + (a.serial ? ' ltr' : ' unknown') + '">' + esc(a.serial || t('غير مسجَّل', 'not recorded')) + '</span></li>' +
          '<li><span class="k">' + t('تاريخ الشراء', 'Purchase date') + '</span><span class="v' + (a.purchaseDate ? '' : ' unknown') + '">' + esc(a.purchaseDate ? A.date(a.purchaseDate) : t('غير مسجَّل', 'not recorded')) + '</span></li>' +
          '<li><span class="k">' + t('الضمان', 'Warranty') + '</span><span class="v"><span class="chip ' + w.c + '">' + esc(w.s) + '</span>' +
            (end ? ' <span class="small muted">' + esc(t('ينتهى ', 'ends ') + A.date(end)) + '</span>' : '') + '</span></li>' +
          '<li><span class="k">' + t('البائع', 'Seller') + '</span><span class="v">' + esc(isExternal(a) ? sellerName(a) : t('صادكو', 'SADKO')) + '</span></li>' +
        '</ul>' +
        '<p class="small" style="margin:10px 0 0">' + t('هذه البيانات مأخوذة من صفحة «أجهزتى» على جهازك، وستُدرَج فى نص الطلب تلقائياً. ',
          'These come from "My appliances" on your device and will be included in the request text automatically. ') +
          '<a href="appliances.html">' + t('عدّلها من هنا', 'Edit them here') + '</a></p></div>';
    }

    /* ================= the request text ================= */

    function buildText() {
      const a = state.deviceId ? O.get(state.deviceId) : null;
      const L = [];
      const line = (k, v) => { if (v) L.push(k + ': ' + v); };
      L.push(t('طلب خدمة عملاء (كُتب من موقع صادكو)', 'Customer care request (written on the SADKO website)'));
      L.push('');
      line(t('الحالة', 'Stage'), state.stage === 'before' ? t('قبل الشراء', 'Before buying') : state.stage === 'after' ? t('بعد الشراء', 'After buying') : '');
      line(t('الجهاز / الطلب', 'Appliance / request'), (a && a.title ? a.title : '') || state.deviceText);
      if (a) {
        line(t('الماركة', 'Brand'), a.brand);
        line(t('الطراز', 'Model'), a.model);
        line(t('الرقم التسلسلى', 'Serial number'), a.serial);
        line(t('تاريخ الشراء', 'Purchase date'), a.purchaseDate ? A.date(a.purchaseDate) : '');
        const dl = O.daysLeft(a), end = O.warrantyEnd(a);
        if (end) line(t('حالة الضمان', 'Warranty status'), dl > 0
          ? t('سارٍ، بقى ' + num(dl) + ' يوم (ينتهى ' + A.date(end) + ')', 'In warranty, ' + num(dl) + ' days left (ends ' + A.date(end) + ')')
          : t('انتهى فى ' + A.date(end), 'Expired on ' + A.date(end)));
        else line(t('حالة الضمان', 'Warranty status'), t('غير محسوبة: تاريخ الشراء أو مدة الضمان ناقص', 'Not calculated: purchase date or warranty length missing'));
        if (a.categoryId) line(t('الفئة', 'Category'), A.catName(a.categoryId));
      }
      line(t('مكان الشراء', 'Bought from'), state.source === 'sadko' ? t('صادكو', 'SADKO')
        : state.source === 'other' ? ((a && a.sellerName) ? a.sellerName : t('متجر آخر', 'Another shop'))
        : state.source === 'none' ? t('لم يُشترَ بعد', 'Not bought yet') : '');
      line(t('نوع الطلب', 'Request type'), label(state.stage === 'before' ? ISSUES_BEFORE : ISSUES_AFTER, state.issue));
      line(t('التركيب', 'Installation'), label(INSTALLED, state.installed));
      line(t('طريقة التواصل المفضلة', 'Preferred contact'), label(CONTACTS, state.contact));
      if (state.name || state.phone || state.area) {
        L.push('');
        line(t('الاسم', 'Name'), state.name);
        line(t('الهاتف', 'Phone'), state.phone);
        line(t('المحافظة / المنطقة', 'Governorate / area'), state.area);
      }
      if (state.detail) { L.push(''); L.push(t('الشرح:', 'Details:')); L.push(state.detail); }
      L.push('');
      L.push(t('كُتب فى: ', 'Written on: ') + A.date(new Date()));
      return L.join('\n');
    }

    function buildSubject() {
      const a = state.deviceId ? O.get(state.deviceId) : null;
      const what = (a && a.title ? a.title : state.deviceText) || t('طلب عام', 'General request');
      const kind = label(state.stage === 'before' ? ISSUES_BEFORE : ISSUES_AFTER, state.issue) || t('استفسار', 'Enquiry');
      return t('طلب خدمة عملاء: ', 'Customer care request: ') + kind + t('، ', ', ') + what;
    }

    function outSection() {
      const text = state.out.text, subject = state.out.subject;
      const mailto = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);
      const external = state.source === 'other';
      return '<section class="panel mt24" id="care-out" aria-labelledby="out-h" tabindex="-1">' +
        '<h2 class="panel__h" id="out-h" style="font-size:1.25rem">' + t('طلبك جاهز، لكنه لم يُرسَل بعد', 'Your request is ready, but not sent yet') + '</h2>' +
        '<p class="note note--warn">' +
          t('لا ترسل هذه الصفحة شيئاً إلى صادكو، ولا يُنشَأ هنا رقم شكوى. ولن يصل الطلب إلا حين ترسله بنفسك: إما بالضغط على «أرسله بالبريد»، أو بالاتصال على ' + TEL + ' وقراءة هذا النص.',
            'This page does not send anything to SADKO, and no ticket number is created here. Your request only reaches us when you send it: press "Send by e-mail", or call ' + TEL + ' and read this text out.') + '</p>' +
        (external ? '<p class="note note--warn mt16">' +
          t('اخترت أنك اشتريت من متجر آخر. والضمان والاسترجاع والتركيب يقدمها ذلك البائع، فأرسل الطلب إليه أولاً، وقد تساعدك صادكو بنصيحة فنية أو بقطع غيار متوفرة لدينا، لكنها لا تغطى ضمان مشتريات من خارجها.',
            'You said you bought this from another shop. Warranty, returns and installation are provided by that seller, so send the request to them first. SADKO can still help with technical advice or parts we stock, but does not cover warranties on purchases made elsewhere.') + '</p>' : '') +
        '<label class="field mt16"><span class="field__l">' + t('نص الطلب', 'Request text') + '</span>' +
          '<textarea class="textarea" id="care-text" readonly rows="14" style="min-height:260px">' + esc(text) + '</textarea>' +
          '<span class="field__hint">' + t('هذا الصندوق للنسخ اليدوى أيضاً: اضغط داخله وحدّد وانسخ إن لم يعمل زر النسخ.',
            'This box is also there for manual copying: click inside, select all and copy if the copy button does not work.') + '</span></label>' +
        '<div class="row">' +
          '<a class="btn btn--primary" href="' + esc(mailto) + '">' + t('أرسله بالبريد', 'Send by e-mail') + '</a>' +
          '<a class="btn btn--teal" href="tel:' + TEL + '" dir="ltr">' + t('اتصل على ' + TEL, 'Call ' + TEL) + '</a>' +
          '<button type="button" class="btn btn--ghost" data-act="copy">' + t('انسخ النص', 'Copy the text') + '</button>' +
          '<button type="button" class="btn btn--quiet" data-act="edit-req">' + t('عدّل الإجابات', 'Change my answers') + '</button>' +
        '</div>' +
        (state.copied ? '<p class="note note--info mt16" role="status">' + esc(state.copied) + '</p>' : '') +
        '<p class="small muted mt16">' + t('يُرسَل البريد إلى ', 'The e-mail goes to ') + '<span class="ltr">' + MAIL + '</span>' +
          t('. وإن لم يفتح زر البريد برنامجاً لديك، فانسخ النص وأرسله من البريد الذى تستخدمه.',
            '. If the e-mail button does not open a mail app, copy the text and send it from whichever e-mail you use.') + '</p>' +
        '</section>';
    }

    /* ================= events ================= */

    function collect(form) {
      const fd = new FormData(form);
      ['stage', 'source', 'issue', 'installed', 'contact', 'deviceId', 'deviceText', 'name', 'phone', 'area', 'detail']
        .forEach(k => { const v = fd.get(k); state[k] = v == null ? (state[k] || '') : String(v); });
      // Picking a recorded appliance fills in where it was bought.
      const a = state.deviceId ? O.get(state.deviceId) : null;
      if (a && !fd.get('source')) state.source = isExternal(a) ? 'other' : 'sadko';
    }

    root.addEventListener('change', e => {
      const form = root.querySelector('#care-form');
      if (!form || !form.contains(e.target)) return;
      const n = e.target.name;
      collect(form);
      if (n === 'deviceId') {
        const a = state.deviceId ? O.get(state.deviceId) : null;
        if (a) { state.source = isExternal(a) ? 'other' : 'sadko'; state.stage = state.stage || 'after'; }
      }
      // Only these change which controls exist, so only these force a re-render.
      if (['stage', 'source', 'contact', 'deviceId'].indexOf(n) >= 0) {
        if (n === 'stage') state.issue = '';
        render();
      }
    });

    root.addEventListener('input', e => {
      const form = root.querySelector('#care-form');
      if (form && form.contains(e.target) && e.target.name) collect(form);
    });

    root.addEventListener('submit', e => {
      if (!e.target.matches('#care-form')) return;
      e.preventDefault();
      collect(e.target);
      state.copied = '';
      state.out = { text: buildText(), subject: buildSubject() };
      render();
      const out = root.querySelector('#care-out');
      if (out) { out.scrollIntoView({ behavior: 'smooth', block: 'start' }); out.focus(); }
    });

    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'edit-req') {
        state.out = null; state.copied = ''; render();
        const f = root.querySelector('#care-form');
        if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (b.getAttribute('data-act') === 'copy') {
        const box = root.querySelector('#care-text');
        if (!box) return;
        const done = ok => {
          state.copied = ok
            ? t('تم النسخ. الصقه فى بريدك أو فى واتساب، وتذكّر أنه لم يُرسَل بعد.',
                'Copied. Paste it into your e-mail or messaging app, and remember it is still not sent.')
            : t('لم يسمح المتصفح بالنسخ التلقائى. حدّد النص من الصندوق أعلاه وانسخه بنفسك.',
                'The browser refused automatic copying. Select the text in the box above and copy it yourself.');
          render();
        };
        let handled = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            handled = true;
            navigator.clipboard.writeText(box.value).then(() => done(true), () => done(false));
          }
        } catch (err) { handled = false; }
        if (!handled) {
          try { box.focus(); box.select(); done(!!document.execCommand('copy')); }
          catch (err2) { done(false); }
        }
      }
    });

    render();
  }

  window.mountCare = mountCare;
})();
