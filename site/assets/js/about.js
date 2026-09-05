/* ============================================================================
   SADKO — "عن صادكو": the brand page.
   ----------------------------------------------------------------------------
   An editorial read rather than a wall of text: who we are → the heritage
   (1961 → 1986 → today) → reach → where to go next. The twelve values and the
   four working rules live on values.html (see valuesLink below).

   Every claim on this page is one the company actually makes about itself.
   Nothing here is padded with invented figures, awards or dates: if it is not
   in the source material, it is not on the page. The only numbers are the
   founding years, the seven showrooms listed on showrooms.html, and the
   "more than 40,000 customers a year" figure.

   Bilingual through skApp.t(ar, en); every string has a faithful English
   twin because the English mode is a real mode, not a machine afterthought.
   ========================================================================== */
(function () {
  'use strict';

  function mountAbout(root) {
    const A = window.skApp;
    const t = A.t, esc = A.esc, P = A.P;

    /* ---------------- the heritage, in order ---------------- */
    const STORY = [
      { yr: '1961',
        hAr: 'مجموعة إخوان غبور',
        hEn: 'Ghabbour Brothers Group',
        pAr: 'اتأسست مجموعة إخوان غبور سنة 1961، وبقت من الرواد فى البيع بالتقسيط لتشكيلة متنوعة من الأجهزة المنزلية والكهربائية، وكمان مركبات نقل المعدات الزراعية.',
        pEn: 'Ghabbour Brothers Group was founded in 1961 and became a leader in instalment sales of a diverse range of home and electrical appliances, as well as vehicles for transporting agricultural equipment.' },

      { yr: '1986',
        hAr: 'تأسيس صادكو',
        hEn: 'SADKO is founded',
        pAr: 'المهندس صادق حنّا غبور — أحد مؤسسى مجموعة إخوان غبور — أسّس صادكو سنة 1986، وهدفه من أول يوم إنها تكون الموزّع الرئيسى للصناعة المصرية المحلية.',
        pEn: 'Eng. Sadek Hanna Ghabbour — a co-founder of Ghabbour Brothers Group — founded SADKO in 1986, with the aim from day one that it would be the main distributor for local Egyptian industry.' },

      { yr: t('الوكالة', 'The agency'),
        hAr: 'الموزّع الحصرى لكريازى',
        hEn: 'Sole distributor of Kiriazi',
        pAr: 'وعلى أساس الهدف ده، بقت صادكو الموزّع الحصرى لكريازى — واحدة من الشركات الرائدة فى صناعة أجهزة عالية الجودة وطويلة العمر فى السوق المصرى.',
        pEn: 'On that basis, SADKO became the sole distributor of Kiriazi — one of the pioneering makers of high-quality, long-lasting appliances in the Egyptian market.' },

      { yr: t('النهارده', 'Today'),
        hAr: 'معارض ومتجر أونلاين',
        hEn: 'Showrooms and an online store',
        pAr: 'جنب المتجر الإلكترونى، عند صادكو مجموعة معارض للبيع المباشر بتخدم أكتر من 40,000 عميل فى السنة فى القاهرة الكبرى والجيزة والإسكندرية والساحل الشمالى لحد مرسى مطروح.',
        pEn: 'Alongside the online store, SADKO has a group of showrooms for direct sales, serving more than 40,000 customers a year across Greater Cairo, Giza, Alexandria and the North Coast up to Marsa Matrouh.' },
    ];

    /* ---------------- reach ---------------- */
    const STATS = [
      { v: '1986', lAr: 'سنة التأسيس', lEn: 'Founded' },
      { v: '+40,000', lAr: 'عميل بنخدمهم فى السنة', lEn: 'Customers served a year' },
      { v: '7', lAr: 'معارض للبيع المباشر', lEn: 'Direct-sales showrooms' },
    ];

    /* ================= sections ================= */

    function lead() {
      return '<section class="panel" aria-labelledby="ab-who">' +
        '<h2 class="ab-h" id="ab-who">' + esc(t('احنا مين', 'Who we are')) + '</h2>' +
        '<p class="ab-lead">' + esc(t(
          'صادكو جروب بيت مصرى لتجارة الأجهزة المنزلية والكهربائية: مجموعة معارض للبيع المباشر ومتجر أونلاين، وخدمة بعد البيع بنعتبرها جزء من البيعة نفسها مش إضافة عليها.',
          'SADKO Group is an Egyptian home and electrical appliance business: a group of direct-sales showrooms and an online store, with after-sales service we treat as part of the sale rather than an extra on top of it.')) + '</p>' +
        '<p class="ab-p">' + esc(t(
          'الشركة اتأسست سنة 1986 على يد المهندس صادق حنّا غبور، وهدفها إنها تكون الموزّع الرئيسى للصناعة المصرية المحلية — وده اللى خلاها تبقى الموزّع الحصرى لكريازى، واحدة من الشركات الرائدة فى صناعة أجهزة عالية الجودة وطويلة العمر فى السوق المصرى.',
          'The company was founded in 1986 by Eng. Sadek Hanna Ghabbour, with the aim of being the main distributor for local Egyptian industry — which is how it became the sole distributor of Kiriazi, one of the pioneering makers of high-quality, long-lasting appliances in the Egyptian market.')) + '</p>' +
        '<blockquote class="pull mt16"><p style="margin:0">' + esc(t(
          'إن الصناعة المحلية تستاهل موزّعاً يقف جنبها.',
          'Local industry deserves a distributor who stands beside it.')) + '</p>' +
          '<cite>' + esc(t('الفكرة اللى اتأسست عليها صادكو سنة 1986', 'The idea SADKO was founded on in 1986')) + '</cite>' +
        '</blockquote></section>';
    }

    function story() {
      return '<section class="ab-sec" aria-labelledby="ab-story">' +
        '<h2 class="ab-h" id="ab-story">' + esc(t('الحكاية', 'The story')) + '</h2>' +
        '<p class="ab-sub">' + esc(t(
          'من بيت تجارة اتأسس فى الستينات، لشركة اتعملت مخصوص عشان تقف جنب المصنع المصرى.',
          'From a trading house founded in the sixties, to a company created specifically to stand beside the Egyptian factory.')) + '</p>' +
        '<div class="panel"><ol class="tl">' + STORY.map(s =>
          '<li><i aria-hidden="true"></i>' +
            '<span class="yr">' + esc(s.yr) + '</span>' +
            '<h3>' + esc(t(s.hAr, s.hEn)) + '</h3>' +
            '<p>' + esc(t(s.pAr, s.pEn)) + '</p>' +
          '</li>').join('') + '</ol></div></section>';
    }

    function reach() {
      return '<section class="ab-sec" aria-labelledby="ab-reach">' +
        '<h2 class="ab-h" id="ab-reach">' + esc(t('وصولنا', 'Our reach')) + '</h2>' +
        '<p class="ab-sub">' + esc(t(
          'جنب المتجر الإلكترونى، عندنا مجموعة معارض للبيع المباشر — والناس اللى بتعدّى علينا فيها كل سنة أكتر من 40,000 عميل.',
          'Alongside the online store we have a group of showrooms for direct sales — and more than 40,000 customers pass through them every year.')) + '</p>' +
        '<ul class="stats">' + STATS.map(s =>
          '<li class="stat"><b class="ltr">' + esc(s.v) + '</b><span>' + esc(t(s.lAr, s.lEn)) + '</span></li>').join('') +
        '</ul>' +
        '<p class="note note--info mt16">' + esc(t(
          'المعارض موزّعة على القاهرة الكبرى والجيزة والإسكندرية والساحل الشمالى لحد مرسى مطروح. معرض مارينا بيشتغل فى موسم الصيف بس، فالأفضل تكلّم المعرض قبل ما تشد الرحال.',
          'The showrooms cover Greater Cairo, Giza, Alexandria and the North Coast up to Marsa Matrouh. The Marina showroom operates in the summer season only, so it is best to call the branch before making the trip.')) + '</p>' +
        '<p class="mt16"><a class="btn btn--ghost btn--sm" href="' + P('showrooms.html') + '">' +
          esc(t('شوف عناوين المعارض السبعة', 'See the seven showroom addresses')) + '</a></p>' +
        '</section>';
    }

    /* The values and the working rules moved to values.html — this page had
       grown into one very long read. A card here keeps them one click away
       instead of simply disappearing from About. */
    function valuesLink() {
      return '<section class="ab-sec panel" aria-labelledby="ab-vlink">' +
        '<h2 class="ab-h" id="ab-vlink">' + esc(t('اللى احنا مؤمنين بيه', 'What we stand for')) + '</h2>' +
        '<p class="ab-p">' + esc(t(
          'اتناشر قيمة وأربع قواعد شغل، مكتوبة بالمعنى اللى بيوصل للعميل — فى صفحة لوحدها.',
          'Twelve values and four working rules, written in terms of what they mean for a customer — on a page of their own.')) + '</p>' +
        '<p style="margin:14px 0 0"><a class="btn btn--teal btn--sm" href="' + P('values.html') + '">' +
          esc(t('اقرا قيمنا', 'Read our values')) + '</a></p>' +
        '</section>';
    }

    function cta() {
      const L = [
        [P('showrooms.html'), 'المعارض والعناوين', 'Showrooms & addresses', 'btn--teal'],
        [P('contact.html'), 'تواصل معانا', 'Contact us', 'btn--primary'],
        [P('finder.html'), 'ساعدنى أختار', 'Help me choose', 'btn--ghost'],
        [P('index.html'), 'ارجع للبيت', 'Back to the home page', 'btn--quiet'],
      ];
      return '<section class="ab-sec panel ab-cta" aria-labelledby="ab-next">' +
        '<h2 class="ab-h" id="ab-next">' + esc(t('تحب تروح فين دلوقتى؟', 'Where would you like to go next?')) + '</h2>' +
        '<p class="ab-sub" style="margin-inline:auto">' + esc(t(
          'لو حابب تشوفنا على أرض الواقع، أو تسأل سؤال، أو تبدأ تدوّر على الجهاز المناسب.',
          'Whether you would rather see us in person, ask a question, or start looking for the right appliance.')) + '</p>' +
        '<div class="row mt16">' + L.map(l =>
          '<a class="btn ' + l[3] + '" href="' + l[0] + '" style="flex:0 1 auto">' + esc(t(l[1], l[2])) + '</a>').join('') +
        '</div></section>';
    }

    root.innerHTML = lead() + story() + reach() + valuesLink() + cta();
  }

  window.mountAbout = mountAbout;
})();
