/* ============================================================================
   SADKO: "About us" (عن صادكو), the brand page.
   ----------------------------------------------------------------------------
   One page since 2026-10-31: the former About and Our Values pages were merged
   at the owner's request, using the owner's own 40-year brand text. Order:
   who we are (the 40-year story) → facts strip → the signature line →
   vision & mission → the five values → where to go next.

   Everything here is the company's own wording, in both languages. Facts in
   the strip are taken from that text only (1986, four decades, the sectors).
   values.html now redirects to #values on this page (nav.js MOVED_PAGES).
   ========================================================================== */
(function () {
  'use strict';

  function mountAbout(root) {
    const A = window.skApp;
    const t = A.t, esc = A.esc, P = A.P;

    const STORY = [
      ['تأسست صادكو في مصر عام ١٩٨٦ كشركة عائلية مصرية، وانطلقت من أسس راسخة من الثقة والعلاقات الإنسانية وروح المبادرة، والفهم العميق للمجتمعات التي تخدمها.',
       'Established in Egypt in 1986, SADKO is a family-owned Egyptian business built on a strong foundation of trust, relationships, entrepreneurship and a deep understanding of the communities it serves.'],
      ['وعلى مدار أربعة عقود، نمت صادكو وتطورت من بداياتها لتصبح مجموعة أعمال متنوعة الأنشطة، تعمل في قطاعات التجارة والتجزئة والتوزيع والتصنيع والخدمات والمبادرات المجتمعية.',
       'Over four decades, SADKO has grown and evolved from its beginnings into a diversified business group operating across multiple sectors, including trade, retail, distribution, manufacturing, services and community initiatives.'],
      ['واليوم، تجمع صادكو منظومة متنامية من الشركات والعلامات التجارية والمبادرات، لكل منها هويتها وخبراتها الخاصة، وتربطها في الوقت نفسه جذور مشتركة وقيم راسخة والتزام بصناعة قيمة مستدامة.',
       'Today, SADKO brings together a growing ecosystem of businesses, brands and initiatives, each with its own identity and expertise, yet connected by a shared heritage, common values and a commitment to creating lasting value.'],
      ['ولا تكمن قوتنا فيما نقدمه من أعمال فحسب، بل في العلاقات التي نبنيها مع شركائنا وعملائنا وموردينا وموظفينا والمجتمعات المحيطة بنا.',
       'Our strength lies not only in what we do, but in the relationships we build: with our partners, customers, suppliers, employees and the communities around us.'],
      ['ومع احتفالنا بمرور ٤٠ عامًا من النمو والإنجاز، نواصل التزامنا بالتطور ومواكبة المتغيرات، واغتنام الفرص الجديدة، وتنمية أعمالنا، وبناء قاعدة أقوى للأجيال القادمة.',
       'As we celebrate 40 years of growth and achievement, we remain committed to evolving with the times, embracing new opportunities, developing our businesses and building a stronger foundation for the generations to come.'],
    ];

    const FACTS = [
      { v: t('١٩٨٦', '1986'), l: t('تأسست فى مصر', 'Established in Egypt') },
      { v: t('٤٠', '40'), l: t('عامًا من النمو والإنجاز', 'Years of growth and achievement') },
      { v: t('عائلية', 'Family'), l: t('شركة مصرية عائلية', 'A family-owned Egyptian business') },
    ];
    const SECTORS = [
      ['التجارة', 'Trade'], ['التجزئة', 'Retail'], ['التوزيع', 'Distribution'],
      ['التصنيع', 'Manufacturing'], ['الخدمات', 'Services'], ['المبادرات المجتمعية', 'Community initiatives'],
    ];

    const VALUES = [
      { ar: 'الثقة', en: 'Trust', dAr: 'الأساس الذي تقوم عليه كل علاقة نبنيها.', dEn: 'The foundation of every relationship we build.' },
      { ar: 'روح المبادرة', en: 'Entrepreneurship', dAr: 'الشجاعة في التطور والابتكار واغتنام الفرص.', dEn: 'The courage to evolve, innovate and seize opportunities.' },
      { ar: 'الشراكة', en: 'Partnership', dAr: 'ننمو معًا مع موظفينا وشركائنا ومجتمعاتنا.', dEn: 'Growing together with our people, partners and communities.' },
      { ar: 'الانتماء', en: 'Belonging', dAr: 'نحافظ على الروح العائلية التي تجمع أعمالنا.', dEn: 'Preserving the family spirit that connects our businesses.' },
      { ar: 'الالتزام', en: 'Commitment', dAr: 'نتحمل مسؤولية أعمالنا والقيمة التي نصنعها.', dEn: 'Taking responsibility for what we do and the value we create.' },
    ];

    function who() {
      return '<section class="panel" aria-labelledby="ab-who">' +
        '<p class="ab-eyebrow">' + esc(t('عن صادكو', 'About SADKO')) + '</p>' +
        '<h2 class="ab-h" id="ab-who">' + esc(t('٤٠ عامًا من بناء الثقة، والتواصل بين الناس، وصناعة القيمة',
          '40 Years of Building Trust. Connecting People. Creating Value.')) + '</h2>' +
        '<p class="ab-lead">' + esc(t(STORY[0][0], STORY[0][1])) + '</p>' +
        STORY.slice(1).map(s => '<p class="ab-p">' + esc(t(s[0], s[1])) + '</p>').join('') +
        '</section>';
    }

    function facts() {
      return '<section class="ab-sec" aria-label="' + esc(t('صادكو فى سطور', 'SADKO at a glance')) + '">' +
        '<ul class="stats">' + FACTS.map(f =>
          '<li class="stat"><b>' + esc(f.v) + '</b><span>' + esc(f.l) + '</span></li>').join('') + '</ul>' +
        '<div class="panel mt16"><h3 class="ab-h3">' + esc(t('قطاعات نعمل فيها', 'Sectors we work in')) + '</h3>' +
          '<ul class="ab-sectors">' + SECTORS.map(s => '<li>' + esc(t(s[0], s[1])) + '</li>').join('') + '</ul></div>' +
        '</section>';
    }

    function signature() {
      return '<section class="ab-sec"><blockquote class="pull ab-sign"><p>' +
        esc(t('صادكو: نبني جسورًا، ونتشارك الحياة.', 'SADKO: Building Bridges. Sharing Lives.')) +
        '</p></blockquote></section>';
    }

    /* The SADKO values artwork, hung like a vintage piece in a carved gold
       frame. No caption beyond a small plaque: the picture says it. Click opens
       the full-size image. */
    function artwork() {
      const src = P('assets/img/sadko-values.jpg');
      return '<section class="ab-sec ab-gallery" aria-label="' + esc(t('قيم صادكو', 'SADKO values')) + '">' +
        '<figure class="ab-frame">' +
          '<a class="ab-frame__mat" href="' + src + '" target="_blank" rel="noopener">' +
            '<img src="' + src + '" width="1408" height="768" loading="lazy" alt="' +
              esc(t('قيم صادكو: المحبة، روح الأسرة، الاستقامة، الاحترام، اللطف، الجمال، الحكمة الجماعية، التعاون، البهجة، الإلهام، الحضور، الوعى',
                'SADKO values: love, family spirit, integrity, respect, kindness, beauty, collective wisdom, cooperation, joy, inspiration, presence, awareness')) + '">' +
          '</a>' +
          '<figcaption class="ab-plaque">' + esc(t('صادكو | منذ ١٩٨٦', 'SADKO | Since 1986')) + '</figcaption>' +
        '</figure></section>';
    }

    function visionMission() {
      return '<section class="ab-sec ab-vm" aria-label="' + esc(t('رؤيتنا ورسالتنا', 'Our vision and mission')) + '">' +
        '<article class="panel ab-card"><h2 class="ab-h">' + esc(t('رؤيتنا', 'Our vision')) + '</h2><p class="ab-p">' +
          esc(t('أن نكون مجموعة أعمال متنوعة ومستدامة، تصنع القيمة، وتربط بين الناس، وتسهم بصورة إيجابية في المجتمعات التي تخدمها.',
            'To build a sustainable and diversified business group that creates value, connects people and contributes positively to the communities we serve.')) + '</p></article>' +
        '<article class="panel ab-card"><h2 class="ab-h">' + esc(t('رسالتنا', 'Our mission')) + '</h2><p class="ab-p">' +
          esc(t('تنمية أعمالنا من خلال علاقات قائمة على الثقة، وروح مبادرة مسؤولة، وتطوير مستمر، والتزام مشترك بالتميز.',
            'To grow our businesses through trusted relationships, responsible entrepreneurship, continuous development and a shared commitment to excellence.')) + '</p></article>' +
        '</section>';
    }

    function values() {
      return '<section class="ab-sec" id="values" aria-labelledby="ab-values">' +
        '<h2 class="ab-h" id="ab-values">' + esc(t('قيمنا', 'Our values')) + '</h2>' +
        '<ol class="ab-values">' + VALUES.map((v, i) =>
          '<li class="ab-value"><span class="ab-value__n" aria-hidden="true">' + (i + 1) + '</span>' +
            '<h3>' + esc(t(v.ar, v.en)) + '</h3><p>' + esc(t(v.dAr, v.dEn)) + '</p></li>').join('') +
        '</ol></section>';
    }

    function cta() {
      const L = [
        [P('showrooms.html'), 'المعارض والعناوين', 'Showrooms & addresses', 'btn--teal'],
        [P('contact.html'), 'تواصل معنا', 'Contact us', 'btn--primary'],
        [P('shop.html'), 'تسوّق المنتجات', 'Shop the products', 'btn--ghost'],
      ];
      return '<section class="ab-sec panel ab-cta" aria-labelledby="ab-next">' +
        '<h2 class="ab-h" id="ab-next">' + esc(t('إلى أين تود الذهاب الآن؟', 'Where would you like to go next?')) + '</h2>' +
        '<div class="row mt16">' + L.map(l =>
          '<a class="btn ' + l[3] + '" href="' + l[0] + '" style="flex:0 1 auto">' + esc(t(l[1], l[2])) + '</a>').join('') +
        '</div></section>';
    }

    root.innerHTML = who() + facts() + signature() + artwork() + visionMission() + values() + cta();
    // arriving from an old values.html link: land on the values
    if (location.hash === '#values') {
      const v = document.getElementById('values');
      if (v) requestAnimationFrame(() => v.scrollIntoView({ block: 'start' }));
    }
  }

  window.mountAbout = mountAbout;
})();
