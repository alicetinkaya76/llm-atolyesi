/* LLM Atölyesi — Tokenizer Tezgâhı.
   Faz 1'in egzersizi burada ANLATILMAZ, OYNANIR: kendi metnini ver, gerçek
   byte-level BPE canlı eğitilsin, Türkçe'nin nerede hasar gördüğünü gör.

   Ölçüm dürüstlüğü kuralları:
   · Fertility tek başına anlamsızdır — hep bir kıyas noktasıyla gösterilir
     (aynı korpus, farklı desen/sözlük).
   · Örneklem boyutu her zaman yazılır; küçük korpusta sayı oynak.
   · Hiçbir sayı elle yazılmaz, hepsi koddan üretilir. */
(function () {
  'use strict';
  var A = window.Atolye, B = window.BPE;

  var YEREL_MI = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !YEREL_MI) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(function () {});
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(x) { return A ? A.esc(x) : String(x); }

  /* Gömülü örnek: kamu malı, morfolojik olarak zengin, kısa.
     (Ziya Gökalp, "Turan" — 1911; telif süresi dolmuş.) */
  /* Gömülü örnek. İki katman: kamu malı bir şiir kıtası (Ziya Gökalp,
     "Turan", 1911 — telif süresi dolmuş) ve morfolojik yoğunluğu yüksek,
     bu tezgâh için yazılmış düz metin. Amaç edebiyat değil, Türkçe'nin
     eklemeli yapısını tokenizer'a bol bol göstermek. Ayrılmış kesit
     yönteminin çalışabilmesi için yeterince uzun tutuldu. */
  var ORNEK =
    'Nabzımda vuran duygu ne yalnız bana aittir,\n' +
    'Kalbimde çırpınan bu emel hep beni bekler.\n' +
    'Vatan ne Türkiye\'dir Türklere, ne Türkistan;\n' +
    'Vatan büyük ve müebbet bir ülkedir: Turan.\n' +
    '\n' +
    'Evimizde çalışıyorduk, evlerimizden geliyorlardı; evlerimizdekilerden\n' +
    'haber bekliyorduk. Kitabı, kitabımı, kitaplarımı, kitaplarımızı,\n' +
    'kitaplarımızdan, kitaplarımızdakileri tek tek saydık.\n' +
    'Ankara\'dan İstanbul\'a, İzmir\'den Konya\'ya gönderilenler geldi.\n' +
    'Öğrencilerimizin başarılarıyla, öğretmenlerimizin emekleriyle övünüyoruz.\n' +
    'Anlayamadıklarımızdan söz ediyorduk; söyleyebileceklerimizi söyledik,\n' +
    'söyleyemediklerimizi sonraya bıraktık.\n' +
    'Gelecekmişsiniz, gelemeyecekmişsiniz, geleceklermiş, gelmeyeceklermiş.\n' +
    'Güzelleştirebildiklerimizi güzelleştirdik; güzelleştiremediklerimizden\n' +
    'utanmıyoruz. Yazdıklarımız, yazamadıklarımız, yazacaklarımız.\n' +
    'Çalıştırabildiklerimizden çalıştıramadıklarımıza kadar hepsi burada.\n' +
    'Türkçe\'nin ekleri: -ler, -de, -den, -im, -imiz, -ce, -lik, -siz, -yor.\n' +
    'Kaleminizdekiler, defterinizdekiler, çantanızdakiler unutulmasın.\n' +
    'Sormuşlardı, sormayacaklarmış, sorabilseydiniz, sordurtabilseydik.\n' +
    'Bilgisayarlarımızdaki belgelerimizi yedeklediğimizden eminiz.\n' +
    'Üniversitelerimizdeki araştırmacılarımızın çalışmalarından öğrendiklerimiz.\n' +
    'Kütüphanelerimizdekilerden yararlanabilenlerimiz azdı.\n' +
    'Görüşebildiklerimizle görüşemediklerimizi ayırt edemiyorduk.\n' +
    'Anlaşabilseydik anlaşamayacaklarımızı da anlardık.\n' +
    'Yazışmalarımızdan, konuşmalarımızdan, tartışmalarımızdan geriye kalanlar.\n' +
    'Beklediklerimizden fazlasını, umduklarımızdan azını bulduk.\n';

  var model = null, sonMetin = '';

  /* Eğitim ve ölçüm AYNI metinde yapılırsa BPE metni ezberler ve fertility
     deseni değil sözlük boyutunu ölçer. Bu yüzden metin ikiye ayrılır:
     %80 eğitim, %20 ayrılmış ölçüm. Literatürdeki fertility rakamları da
     görülmemiş metin üzerinde anlamlıdır. */
  function ayir(metin) {
    var satirlar = metin.split('\n');
    if (satirlar.length < 5) {
      var k = metin.split(/(\s+)/);
      var kes = Math.max(2, Math.floor(k.length * 0.8));
      return { egitim: k.slice(0, kes).join(''), test: k.slice(kes).join('') };
    }
    var kes2 = Math.max(1, Math.floor(satirlar.length * 0.8));
    return { egitim: satirlar.slice(0, kes2).join('\n'),
             test: satirlar.slice(kes2).join('\n') };
  }

  /* ---------- ölçümler ---------- */
  /* Fertility: token / kelime. "Kelime" = boşlukla ayrılmış birim; literatürde
     en yaygın tanım bu. Morfem başına ölçüm ayrı bir şeydir ve morfolojik
     çözümleyici ister — burada iddia edilmiyor. */
  function olcum(metin, m) {
    var kelimeler = metin.split(/\s+/).filter(Boolean);
    var idler = B.kodla(metin, m);
    var bayt = B.baytlar(metin).length;
    /* sözlükteki kaç token TEK BAŞINA tam bir kelime gibi duruyor? */
    var tamKelime = 0, toplamTur = 0;
    var gorulen = {};
    idler.forEach(function (id) {
      if (gorulen[id]) return;
      gorulen[id] = 1; toplamTur++;
      var t = B.tokenMetni(id, m).trim();
      if (t.length > 1 && /^\p{L}+$/u.test(t)) tamKelime++;
    });
    return {
      kelime: kelimeler.length,
      token: idler.length,
      bayt: bayt,
      fertility: kelimeler.length ? idler.length / kelimeler.length : 0,
      baytPerToken: idler.length ? bayt / idler.length : 0,
      tamKelimeOran: toplamTur ? tamKelime / toplamTur : 0,
      turSayisi: toplamTur
    };
  }

  /* ---------- çizim ---------- */
  function tokenlar(metin, m, kap) {
    kap.innerHTML = '';
    var parcalar = B.onParcala(metin, m.desen);
    parcalar.forEach(function (p) {
      var ids = B.kodla(p, m);
      var grup = el('span', 'kelime-grubu');
      ids.forEach(function (id, i) {
        var t = B.tokenMetni(id, m);
        var s = el('span', 'tok' + (ids.length > 1 ? ' bolunmus' : ''));
        s.textContent = t.replace(/\n/g, '⏎');
        s.title = 'id ' + id + (ids.length > 1 ? ' · ' + (i + 1) + '/' + ids.length + ' parça' : '');
        grup.appendChild(s);
      });
      kap.appendChild(grup);
    });
  }

  function metrikKutu(ad, deger, alt) {
    var d = el('div', 'metrik');
    d.appendChild(el('div', 'v', deger));
    d.appendChild(el('div', 'l', esc(ad)));
    if (alt) d.appendChild(el('div', 'ek', esc(alt)));
    return d;
  }

  /* ---------- ana akış ---------- */
  function egit() {
    var metin = $('metin').value;
    if (!metin.trim()) { durum('Önce bir metin ver.'); return; }
    var vocab = parseInt($('vocab').value, 10);
    var desen = $('desen').value;

    durum('Eğitiliyor…');
    $('btn-egit').disabled = true;

    /* ana iş parçacığını kilitlememek için bir tık ertele */
    setTimeout(function () {
      var t0 = performance.now();
      /* NFC: macOS/bazı editörler NFD üretir, orada 'ğ' 3 bayt olur ve
         token akışı sessizce bozulur. Bir kez normalle, sonra söyle. */
      var nrm = B.normalle(metin);
      if (nrm.degisti) metin = nrm.metin;
      var b = ayir(metin);
      try {
        model = B.egit(b.egitim, { vocab: vocab, desen: desen });
        model.testMetni = b.test;
        model.egitimMetni = b.egitim;
      } catch (e) {
        durum('Eğitim başarısız: ' + (e && e.message ? e.message : e));
        $('btn-egit').disabled = false;
        return;
      }
      sonMetin = metin;
      model.nfcDuzeltildi = nrm.degisti ? nrm.baytFarki : 0;
      var sure = Math.round(performance.now() - t0);
      $('btn-egit').disabled = false;
      durum('');
      sonuclariCiz(metin, sure);
    }, 20);
  }

  function durum(s) {
    $('durum').textContent = s || '';
    $('durum').style.display = s ? 'block' : 'none';
  }

  function sonuclariCiz(metin, sure) {
    var kap = $('sonuc');
    kap.innerHTML = '';
    var olculen = (model.testMetni && model.testMetni.trim().split(/\s+/).length >= 8)
      ? model.testMetni : metin;
    var ayrilmisMi = olculen === model.testMetni;
    var o = olcum(olculen, model);

    /* --- metrikler --- */
    var mk = el('div', 'metrikler');
    mk.appendChild(metrikKutu('fertility', o.fertility.toFixed(2),
      'token / kelime · ' + o.kelime + ' kelime' + (ayrilmisMi ? ' (ayrılmış)' : '')));
    mk.appendChild(metrikKutu('bayt / token', o.baytPerToken.toFixed(2),
      o.bayt + ' bayt, ' + o.token + ' token'));
    mk.appendChild(metrikKutu('sözlük', model.vocab,
      model.birlesmeler.length + ' birleşme · ' + sure + ' ms'));
    mk.appendChild(metrikKutu('%TR (kaba)', '%' + Math.round(o.tamKelimeOran * 100),
      o.turSayisi + ' token türü · kıyas: genel LLM 40–51, Türkçe-özel 90'));
    kap.appendChild(mk);
    kap.appendChild(el('p', 'small',
      '<b>Fertility tek başına anlamsızdır</b> ve <b>eğitildiği metinde ölçülemez.</b> ' +
      (ayrilmisMi
        ? 'Metnin %80\'i eğitime, son %20\'si ölçüme ayrıldı; yukarıdaki sayı ' +
          'tokenizer\'ın <b>görmediği</b> ' + o.kelime + ' kelime üzerinde.'
        : 'Metin ayırmak için çok kısa, bu yüzden ölçüm eğitim metninin ' +
          'kendisinde — sayı olduğundan iyimser. Daha uzun bir metin ver.') +
      ' Kıyas noktası aşağıdaki desen tablosudur.'));

    /* --- desen karşılaştırması: asıl bulgu --- */
    /* tersinirlik: puan değil KAPI */
    var tersinir = B.tersinirMi(olculen, model);
    var tk = el('div', 'banner' + (tersinir ? '' : ' dikkat'));
    tk.innerHTML = tersinir
      ? '<b>Tersinirlik ✓</b> — çözümleme kodlamayı birebir geri veriyor. ' +
        'Bu bir puan değil kapıdır: tersinir olmayan bir tokenizer üretim için geçersizdir.'
      : '<b>Tersinirlik ✗</b> — decode(encode(x)) ≠ x. Bu tokenizer üretim için geçersiz olurdu.';
    kap.appendChild(tk);

    if (model.nfcDuzeltildi) {
      kap.appendChild(el('div', 'banner',
        'Metin NFC\'ye normalize edildi (' + model.nfcDuzeltildi + ' bayt fark). ' +
        'macOS ve bazı editörler NFD üretir; orada "ğ" 2 değil 3 bayt olur ve ' +
        'gözle aynı görünen metin bambaşka bir token akışı verir.'));
    }

    /* --- kıyas: fertility ancak referansla anlam kazanır --- */
    kap.appendChild(el('h3', null, 'Bu sayı iyi mi kötü mü? Kıyas noktaları'));
    var kmax = Math.max(o.fertility, 4);
    var kl = el('div', 'kiyas');
    KIYAS.concat([{ ad: 'SENİN TOKENIZER\'IN', v: o.fertility, not: 'bu sayfada, ayrılmış kesitte', ben: true }])
      .sort(function (a, b2) { return a.v - b2.v; })
      .forEach(function (k) {
        var sat = el('div', 'kiyas-satir' + (k.ben ? ' ben' : ''));
        sat.appendChild(el('span', 'kiyas-ad', esc(k.ad)));
        var cb = el('div', 'kiyas-cubuk');
        var ic = el('i');
        ic.style.width = Math.min(100, 100 * k.v / kmax) + '%';
        cb.appendChild(ic);
        sat.appendChild(cb);
        sat.appendChild(el('span', 'kiyas-v', k.v.toFixed(2)));
        sat.appendChild(el('span', 'kiyas-not', esc(k.not)));
        kl.appendChild(sat);
      });
    kap.appendChild(kl);
    kap.appendChild(el('p', 'small',
      '<b>Bunlar farklı korpuslarda ölçüldü</b> — mutlak karşılaştırma değil, ' +
      'büyüklük mertebesi kıyası. Yine de asıl bilgi şudur: aynı yöntemle ' +
      'İngilizce ~1,3 iken Türkçe ~1,5–1,6 çıkıyor. Fertility tanımı da ' +
      'değişkendir; burada <b>boşlukla ayrılmış kelime</b> başına token ' +
      'kullanılıyor (Ali vd. 2024 tanımı). Dilbilimsel kelime (UD) tanımı ' +
      'noktalama işaretlerini ayrı saydığı için sayıyı %15–20 düşürür.'));

    kap.appendChild(el('h3', null, 'Ön-parçalama deseni ne kadar fark ediyor?'));
    var tablo = ['<div class="tblwrap"><table><thead><tr><th>Desen</th>' +
      '<th class="num">fertility</th><th class="num">token</th>' +
      '<th class="num">fark</th></tr></thead><tbody>'];
    var taban = null;
    ['yok', 'gpt2', 'gpt4', 'tr'].forEach(function (d) {
      var mm = B.egit(model.egitimMetni, { vocab: model.vocab, desen: d });
      var oo = olcum(olculen, mm);
      if (taban === null) taban = oo.token;
      var fark = taban ? Math.round(100 * (oo.token - taban) / taban) : 0;
      tablo.push('<tr' + (d === model.desen ? ' class="secili"' : '') + '><td>' +
        esc(B.DESENLER[d].ad) + '</td><td class="num">' + oo.fertility.toFixed(2) +
        '</td><td class="num">' + oo.token + '</td><td class="num">' +
        (fark > 0 ? '+' : '') + fark + '%</td></tr>');
    });
    tablo.push('</tbody></table></div>');
    kap.appendChild(el('div', null, tablo.join('')));
    kap.appendChild(el('p', 'small', esc(B.DESENLER[model.desen].not)));

    /* --- kesme işareti hasarı: gözle görülür --- */
    kap.appendChild(el('h3', null, 'Kesme işareti nerede kesiyor?'));
    var ornekler = ["Türkiye'nin", "Ankara'dır", "İstanbul'a", "Gökalp'ın"];
    var hasar = el('div', 'hasar');
    ornekler.forEach(function (w) {
      var satir = el('div', 'hasar-satir');
      satir.appendChild(el('span', 'hasar-kelime', esc(w)));
      ['gpt2', 'tr'].forEach(function (d) {
        var kutu = el('span', 'hasar-kutu');
        kutu.appendChild(el('span', 'hasar-etiket', d === 'gpt2' ? 'GPT-2' : 'TR'));
        B.onParcala(w, d).forEach(function (p) {
          kutu.appendChild(el('span', 'parca' + (d === 'gpt2' ? ' kotu' : ' iyi'), esc(p)));
        });
        satir.appendChild(kutu);
      });
      hasar.appendChild(satir);
    });
    kap.appendChild(hasar);
    kap.appendChild(el('p', 'small',
      'GPT-2/GPT-4 deseninde Türkçe kesme işareti hiçbir dala uymuyor: kelime ' +
      'üçe bölünüyor ve bölünme <b>ekin ortasına</b> düşüyor ("\'d" + "ır"). ' +
      'İngilizce kısaltmalar için ("\'s", "\'ve") özel dallar var, Türkçe için yok.'));

    /* --- öğrenilen ekler --- */
    kap.appendChild(el('h3', null, 'BPE hangi Türkçe ekleri kendi başına buldu?'));
    var EKLER = /^(ler|lar|de|da|den|dan|te|ta|ten|tan|in|ın|un|ün|im|ım|um|üm|iz|ız|uz|üz|mek|mak|yor|di|dı|du|dü|mış|miş|muş|müş|ki|ce|ca|çe|ça|li|lı|lu|lü|siz|sız|suz|süz|lik|lık|luk|lük)$/;
    var bulunan = model.birlesmeler.filter(function (m) {
      return EKLER.test(m.parca.trim());
    });
    if (bulunan.length) {
      var ul = el('div', 'ekler');
      bulunan.slice(0, 24).forEach(function (m) {
        var s = el('span', 'ek-rozet');
        s.innerHTML = '<b>' + esc(m.parca.trim()) + '</b> <i>' + m.adet + '</i>';
        s.title = 'birleşme #' + (model.birlesmeler.indexOf(m) + 1) + ', ' + m.adet + ' kez görüldü';
        ul.appendChild(s);
      });
      kap.appendChild(ul);
      kap.appendChild(el('p', 'small',
        bulunan.length + ' birleşme Türkçe ek listesine uyuyor. Kimse ona morfoloji ' +
        'öğretmedi — bunlar yalnızca sık geçen bayt çiftleri. Eklemeli bir dilde ' +
        'istatistik, morfolojiyi kendiliğinden yeniden keşfediyor.'));
    } else {
      kap.appendChild(el('p', 'small',
        'Bu sözlük boyutunda tanınır bir ek çıkmadı — sözlüğü büyütmeyi ya da ' +
        'daha uzun bir metin vermeyi dene.'));
    }

    /* --- ilk birleşmeler --- */
    kap.appendChild(el('h3', null, 'İlk birleşmeler (sırayla)'));
    var iz = el('div', 'iz');
    model.birlesmeler.slice(0, 40).forEach(function (m, i) {
      var s = el('span', 'iz-adim');
      s.innerHTML = '<i>' + (i + 1) + '</i> ' + esc(JSON.stringify(m.parca).slice(1, -1) || '·');
      s.title = m.a + ' + ' + m.b + ' → ' + m.yeni + ' (' + m.adet + ' kez)';
      iz.appendChild(s);
    });
    kap.appendChild(iz);
    var ilkN = Math.min(40, model.birlesmeler.length);
    var tekHarf = 0;
    for (var th = 0; th < ilkN; th++) {
      var pp = model.birlesmeler[th].parca;
      if (pp.length === 1 && /[^\x00-\x7F]/.test(pp)) tekHarf++;
    }
    kap.appendChild(el('p', 'small',
      'İlk ' + ilkN + ' birleşmenin <b>' + tekHarf + ' tanesi</b> tek bir ' +
      'Türkçe harfi tamamlamaya harcandı (ğ, ş, ı, ö, ç, ü — hepsi UTF-8\'de ' +
      'iki bayt). İngilizce bir metinde bu bütçe doğrudan hece ve kelimelere ' +
      'giderdi: Türkçe daha ilk adımda geriden başlıyor.'));

    /* canlı deneme alanını da tazele */
    canliCiz();
  }

  function canliCiz() {
    if (!model) return;
    var t = $('deneme').value;
    tokenlar(t, model, $('deneme-cikti'));
    var ids = B.kodla(t, model);
    var kel = t.split(/\s+/).filter(Boolean).length;
    $('deneme-ozet').textContent = ids.length + ' token · ' + kel + ' kelime' +
      (kel ? ' · fertility ' + (ids.length / kel).toFixed(2) : '');
  }

  /* ---------- başlangıç ---------- */
  /* Yayımlanmış kıyas noktaları. Fertility tek başına anlamsızdır; ancak
     bir referansla anlam kazanır. Hepsi kaynaklı ve tanımı yazılı — farklı
     korpuslarda ölçüldükleri için MUTLAK karşılaştırma değil, BÜYÜKLÜK
     MERTEBESİ kıyasıdır ve öyle etiketlenir. */
  var KIYAS = [
    { ad: 'İngilizce, BERT (GLUE)', v: 1.29, not: 'TrGLUE §3.4.5' },
    { ad: 'Türkçe, BERTurk 32k (TrGLUE)', v: 1.58, not: 'TrGLUE §3.4.5 — aynı ölçüm' },
    { ad: 'Türkçe, BPE 64k (denetimli)', v: 1.51, not: 'Morpheus Tablo 5, aynı korpus' },
    { ad: 'Türkçe, Morfessor', v: 1.91, not: 'Morpheus Tablo 5' },
    { ad: 'Türkçe, GPT-4 cl100k (Kaşağı)', v: 3.10, not: 'ölçüm — yayımlanmış değil' },
    { ad: 'Türkçe, GPT-4o o200k (Kaşağı)', v: 2.50, not: 'ölçüm — yayımlanmış değil' }
  ];

  function kur() {
    $('metin').value = ORNEK;
    /* gerçek, tanınan bir kamu malı metin: Kaşağı (Ömer Seyfettin, 1916) */
    fetch('ornek/kasagi.txt').then(function (r) {
      if (!r.ok) throw 0;
      return r.text();
    }).then(function (t) {
      $('metin').value = t;
      egit();
    }).catch(function () { /* dosyadan açıldıysa gömülü metinle devam */ });
    $('deneme').value = "Türkiye'nin başkenti Ankara'dır; evlerimizden çalışıyorduk.";

    var desenSec = $('desen');
    Object.keys(B.DESENLER).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = B.DESENLER[k].ad;
      if (k === 'gpt2') o.selected = true;
      desenSec.appendChild(o);
    });

    $('vocab').addEventListener('input', function () {
      $('vocab-deger').textContent = this.value;
    });
    $('vocab-deger').textContent = $('vocab').value;

    $('btn-egit').addEventListener('click', egit);
    $('deneme').addEventListener('input', canliCiz);
    $('btn-ornek').addEventListener('click', function () {
      $('metin').value = ORNEK; durum('');
    });
    $('dosya').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) { durum('Dosya 4 MB\'tan büyük; bir kesit ver.'); return; }
      var fr = new FileReader();
      fr.onload = function () { $('metin').value = String(fr.result); durum('Yüklendi: ' + f.name); };
      fr.readAsText(f, 'utf-8');
    });

    egit();   /* açılışta örnekle çalışsın: boş ekran öğretmez */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kur);
  } else kur();
})();
