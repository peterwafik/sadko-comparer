/* ============================================================================
   SADKO — "عن صادكو": the brand page.
   ----------------------------------------------------------------------------
   An editorial read rather than a wall of text: who we are → the heritage
   (1961 → 1986 → today) → the twelve values → how we work → reach → where to
   go next.

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

    /* ---------------- the twelve values ----------------
       Each one is described in human terms: what it means for the person
       standing in front of us. No internal mapping, no product features. */
    const VALUES = [
      { ar: 'المحبة', en: 'Love',
        dAr: 'بنتعامل مع اللى قدامنا كإنسان قبل ما يكون عملية بيع — والنصيحة الصادقة تسبق البيعة.',
        dEn: 'We deal with the person in front of us as a person before a sale — honest advice comes before the transaction.' },
      { ar: 'روح العائلة', en: 'Family spirit',
        dAr: 'علاقتنا بيك ما بتخلصش عند باب المعرض؛ نفس الناس اللى باعت لك هى اللى بتتابع معاك بعد كده.',
        dEn: 'Our relationship with you does not end at the showroom door; the same people who sold to you are the ones who follow up afterwards.' },
      { ar: 'النزاهة', en: 'Integrity',
        dAr: 'السعر والمواصفات وشروط الضمان بنقولها زى ما هى — ولو الجهاز مش مناسب لبيتك، بنقولها برضه.',
        dEn: 'Price, specifications and warranty terms are told as they are — and if an appliance is wrong for your home, we say that too.' },
      { ar: 'الاحترام', en: 'Respect',
        dAr: 'وقتك وميزانيتك وقرارك محترمين. مفيش ضغط، ومفيش استعجال على حاجة انت لسه بتفكر فيها.',
        dEn: 'Your time, your budget and your decision are respected. No pressure, and no rushing you on something you are still thinking about.' },
      { ar: 'اللطف', en: 'Kindness',
        dAr: 'أى سؤال — مهما بان بسيط أو متكرر — يستاهل رد هادى وواضح من غير ما حد يحسسك إنه تافه.',
        dEn: 'Any question — however simple or repeated it seems — deserves a calm, clear answer with no one making you feel it was a silly one.' },
      { ar: 'الجمال', en: 'Beauty',
        dAr: 'الجهاز جزء من شكل بيتك، مش صندوق فى الركن. فبنهتم بشكله وتشطيبه زى ما بنهتم بأدائه.',
        dEn: 'An appliance is part of how your home looks, not a box in the corner — so we care about its finish as much as its performance.' },
      { ar: 'الحكمة الجماعية', en: 'Collective wisdom',
        dAr: 'خبرة البائع والفنى وخدمة العملاء بتتجمع مع بعض، عشان اللى يوصل لك يبقى رأى الفريق كله مش اجتهاد فردى.',
        dEn: 'What the salesperson, the technician and customer care each know is pooled, so what reaches you is the whole team’s view rather than one person’s guess.' },
      { ar: 'التعاون', en: 'Cooperation',
        dAr: 'شغلنا مع المصنّعين وزمايلنا فى المعارض قايم على التعاون، وده اللى بيخلى الرد والخدمة أسرع لما تحتاجهم.',
        dEn: 'Our work with manufacturers and between showrooms runs on cooperation, and that is what makes the answer and the service faster when you need them.' },
      { ar: 'البهجة', en: 'Joy',
        dAr: 'شراء جهاز للبيت لحظة فرح فى العيلة. بنحب نحافظ على الفرحة دى من أول ما تدخل المعرض لحد ما الجهاز يشتغل.',
        dEn: 'Buying an appliance is a happy moment in a family. We like to protect that from the moment you walk in until the appliance is running.' },
      { ar: 'الإلهام', en: 'Inspiration',
        dAr: 'نفسنا تخرج من عندنا بفكرة تخلى يومك أسهل — مش بمنتج زيادة كنت ممكن تستغنى عنه.',
        dEn: 'We would rather you leave with an idea that makes your day easier than with an extra product you could have done without.' },
      { ar: 'الحضور', en: 'Presence',
        dAr: 'موجودين قبل الشراء وبعده. لما تحتاجنا تلاقى حد يرد، سواء فى المعرض أو على التليفون.',
        dEn: 'We are there before the purchase and after it. When you need us, someone answers — in the showroom or on the phone.' },
      { ar: 'الوعى', en: 'Awareness',
        dAr: 'بننبّه لاستهلاك الكهرباء والمياه وتأثيره على فاتورتك وعلى البيئة، حتى لو ده معناه إنك تشترى أقل.',
        dEn: 'We flag electricity and water consumption and what it does to your bill and to the environment — even when that means you buy less.' },
    ];

    /* ---------------- how we work ---------------- */
    const WORK = [
      { hAr: 'الشراكة: تبادل نقاط القوة',
        hEn: 'Partnership: exchanging strengths',
        pAr: 'مبدأنا فى الشراكة إن كل طرف يقدّم اللى هو شاطر فيه، عشان نوصل لنمو مشترك. وأى شراكة عندنا مبنية على الكفاءة المهنية والعدل والاحترام والثقة — مش على مين يكسب الجولة دى.',
        pEn: 'Our principle of partnership is that each side brings what it is strong at, so that both grow together. Every partnership we enter is built on professional competence, fairness, respect and trust — not on who wins this round.' },
      { hAr: 'علاقة طويلة، مش صفقة واحدة',
        hEn: 'A long relationship, not one deal',
        pAr: 'بنشتغل على علاقات مثمرة وطويلة المدى مع عملائنا، وعلى خدمة بعد البيع بكفاءة عالية. الجهاز بيعيش سنين، والمفروض اللى باعهولك يعيش معاه السنين دى.',
        pEn: 'We work for productive, long-term relationships with our customers, and for highly efficient after-sales service. An appliance lasts years, and whoever sold it to you should be there for those years.' },
      { hAr: 'احنا جزء من المجتمع',
        hEn: 'We are part of society',
        pAr: 'بنؤمن إن صادكو جزء من المجتمع، وهدفنا نخدم الأسرة المصرية والبيت المصرى بكل مستوياته وشرايحه، فى مدن ومجتمعات مختلفة، ونخلى حياتهم أسهل وأبهج.',
        pEn: 'We believe SADKO is part of society. Our aim is to serve Egyptian families and homes of all levels and segments, across different cities and communities, and to make their lives easier and more joyful.' },
      { hAr: 'المنتج والبيئة',
        hEn: 'The product and the environment',
        pAr: 'وعشان كده بنحرص نوفّر أفضل المنتجات فى الكفاءة والجودة، ومنتجات بتراعى البيئة ونظافتها — لأن اللى بيدخل البيت بيأثر على اللى برّه البيت كمان.',
        pEn: 'That is why we take care to provide the best products in efficiency and quality, and products that respect the environment and its cleanliness — because what comes into the home affects what is outside it too.' },
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

    function values() {
      return '<section class="ab-sec" aria-labelledby="ab-vals">' +
        '<h2 class="ab-h" id="ab-vals">' + esc(t('اللى احنا مؤمنين بيه', 'What we stand for')) + '</h2>' +
        '<p class="ab-sub">' + esc(t(
          'اتناشر قيمة، مكتوبة هنا بالمعنى اللى بيوصل للعميل مش بالمعنى اللى بيتقال فى الاجتماعات.',
          'Twelve values, written here in terms of what they mean for a customer rather than what they sound like in a meeting.')) + '</p>' +
        '<ul class="vals">' + VALUES.map((v, i) =>
          '<li class="val"><span class="n" aria-hidden="true">' + (i + 1) + '</span>' +
            '<h3>' + esc(v.ar) + '<span class="en ltr">' + esc(v.en) + '</span></h3>' +
            '<p>' + esc(t(v.dAr, v.dEn)) + '</p>' +
          '</li>').join('') + '</ul></section>';
    }

    function work() {
      return '<section class="ab-sec" aria-labelledby="ab-work">' +
        '<h2 class="ab-h" id="ab-work">' + esc(t('إزاى بنشتغل', 'How we work')) + '</h2>' +
        '<p class="ab-sub">' + esc(t(
          'أربع قواعد بتحكم علاقتنا بالعميل وبالشريك وبالمنتج نفسه.',
          'Four rules that govern our relationship with the customer, the partner, and the product itself.')) + '</p>' +
        '<div class="grid2 ab-work">' + WORK.map(w =>
          '<div class="panel"><h3 class="panel__h">' + esc(t(w.hAr, w.hEn)) + '</h3>' +
          '<p class="ab-p" style="margin:0">' + esc(t(w.pAr, w.pEn)) + '</p></div>').join('') +
        '</div></section>';
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

    root.innerHTML = lead() + story() + values() + work() + reach() + cta();
  }

  window.mountAbout = mountAbout;
})();
