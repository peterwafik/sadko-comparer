/* ============================================================================
   SADKO — "قيمنا" / "Our Values": the twelve values and the four working rules.
   ----------------------------------------------------------------------------
   Split out of about.js, which had grown into one very long editorial read.
   About now covers who we are, the heritage and the reach; this page covers
   what we stand for and how we work. Both link to each other.

   Every claim here is one the company actually makes about itself — nothing is
   padded with invented figures, awards or dates.

   Bilingual through skApp.t(ar, en). NOTE the value headings: they used to
   print the Arabic name AND the English name together on every card, in both
   modes, so an English reader always saw Arabic on this page. Each card now
   shows the name in the page's language only.
   ========================================================================== */
(function () {
  'use strict';

  function mountValues(root) {
    const A = window.skApp;
    const t = A.t, esc = A.esc, P = A.P;

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

    /* ================= sections ================= */

    function values() {
      return '<section class="ab-sec" aria-labelledby="ab-vals">' +
        '<h2 class="ab-h" id="ab-vals">' + esc(t('اللى احنا مؤمنين بيه', 'What we stand for')) + '</h2>' +
        '<p class="ab-sub">' + esc(t(
          'اتناشر قيمة، مكتوبة هنا بالمعنى اللى بيوصل للعميل مش بالمعنى اللى بيتقال فى الاجتماعات.',
          'Twelve values, written here in terms of what they mean for a customer rather than what they sound like in a meeting.')) + '</p>' +
        '<ul class="vals">' + VALUES.map((v, i) =>
          '<li class="val"><span class="n" aria-hidden="true">' + (i + 1) + '</span>' +
            // One language only. This heading used to print v.ar AND v.en on every
            // card in both modes, which put Arabic on the English page.
            '<h3>' + esc(t(v.ar, v.en)) + '</h3>' +
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

    function cta() {
      const L = [
        [P('about.html'), 'حكاية صادكو', 'The SADKO story', 'btn--teal'],
        [P('showrooms.html'), 'المعارض والعناوين', 'Showrooms & addresses', 'btn--ghost'],
        [P('contact.html'), 'تواصل معانا', 'Contact us', 'btn--primary'],
      ];
      return '<section class="ab-sec panel ab-cta" aria-labelledby="ab-next">' +
        '<h2 class="ab-h" id="ab-next">' + esc(t('تحب تعرف أكتر؟', 'Want to know more?')) + '</h2>' +
        '<p class="ab-sub" style="margin-inline:auto">' + esc(t(
          'القيم دى مالهاش لازمة من غير الحكاية اللى وراها والناس اللى بتنفّذها.',
          'These values mean little without the story behind them and the people who carry them out.')) + '</p>' +
        '<div class="row mt16">' + L.map(l =>
          '<a class="btn ' + l[3] + '" href="' + l[0] + '" style="flex:0 1 auto">' + esc(t(l[1], l[2])) + '</a>').join('') +
        '</div></section>';
    }

    root.innerHTML = values() + work() + cta();
  }

  window.mountValues = mountValues;
})();
