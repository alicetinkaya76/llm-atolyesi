/* node --test atolye.test.mjs
   Matematiğin DOĞRU olduğunu sınar. Eskiden buradaki testin işi iki dildeki
   iki uygulamanın birbirine UYDUĞUNU sınamaktı — yani kendi yarattığımız
   sorunun bekçiliği. Tek uygulamaya geçince o sınıf tamamen kapandı; geriye
   yalnız gerçek sorular kaldı. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  tavan, esik, durumOku, basamakAta, hesap, bosDurum, fazSayfasi
} from './atolye.mjs';

const muf = JSON.parse(readFileSync(new URL('./mufredat.json', import.meta.url), 'utf8'));
const madde = id => muf.items.find(i => i.id === id);

test('basamak semantiği: yap 0-4, oku 0-2, max geçersiz kılar', () => {
  assert.equal(tavan(madde('f0a')), 4);      // yap, varsayılan
  assert.equal(tavan(madde('z2')), 2);       // oku
  assert.equal(tavan(madde('z1')), 3);       // max: 3
  assert.equal(esik(madde('f0a')), 3);
  assert.equal(esik(madde('z2')), 2);
  assert.equal(esik(madde('z1')), 3);        // max ile sınırlı
});

test('faz sayfası: kimlik f0 → dosya faz0.html (bir kez hata olmuştu)', () => {
  assert.equal(fazSayfasi('z'), 'fazlar/zemin.html');
  assert.equal(fazSayfasi('f0'), 'fazlar/faz0.html');
  assert.equal(fazSayfasi('f5'), 'fazlar/faz5.html');
});

test('durumOku bozuk veriyi sessizce ayıklar', () => {
  const d = durumOku({
    items: { z1: 3, z2: { n: 9, t: 'bozuk' }, yokBoyleMadde: 2, f0a: { n: 'abc' } },
    journal: [
      { date: '2026-08-24', hours: 2 },
      { date: 'OLMAZ', hours: 5 },
      { date: '2026-08-26', hours: -3 }
    ]
  }, muf);
  assert.equal(d.items.z1.n, 3);
  assert.equal(d.items.z1.t, null);          // v1 biçimi: tarih bilinmiyor
  assert.equal(d.items.z2.n, 2);             // tavana kırpıldı
  assert.equal(d.items.z2.t, null);          // bozuk tarih düştü
  assert.equal(d.items.yokBoyleMadde, undefined);
  assert.equal(d.items.f0a, undefined);
  assert.equal(d.journal.length, 2);
  assert.equal(d.journal[1].hours, 0);       // negatif saat sıfırlandı
});

test('basamakAta tek yazıcıdır ve gereksiz yazmaz', () => {
  const d = bosDurum();
  assert.equal(basamakAta(d, madde('f0a'), 2, '2026-08-01'), true);
  assert.equal(basamakAta(d, madde('f0a'), 2, '2026-08-02'), false);  // değişiklik yok
  assert.equal(d.items.f0a.t, '2026-08-01');
  assert.equal(basamakAta(d, madde('f0a'), 99, '2026-08-03'), true);
  assert.equal(d.items.f0a.n, 4);            // tavana kırpıldı
  assert.equal(basamakAta(d, madde('f0a'), 0, '2026-08-04'), true);
  assert.equal(d.items.f0a, undefined);
});

test('kapı kuralı: hepsi eşikte VE biri tavanda', () => {
  const d = bosDurum();
  const zc = muf.items.filter(i => i.p === 'z' && i.core);
  for (const i of zc) basamakAta(d, i, esik(i), '2026-01-01');
  const h1 = hesap(muf, d, '2026-08-27');
  /* z1'in tavanı 3 ve eşiği 3 — yani eşiğe çekmek onu zaten tavana koyar,
     dolayısıyla kapı bu hâliyle geçilmiş olmalı. */
  assert.equal(h1.kapi('z'), 'gecildi');

  /* f0'da hiçbir maddenin eşiği tavanına eşit değil mi? f0e max:3, esik:3 */
  const d2 = bosDurum();
  for (const i of muf.items.filter(i => i.p === 'f0' && i.core)) {
    basamakAta(d2, i, esik(i), '2026-01-01');
  }
  assert.equal(hesap(muf, d2, '2026-08-27').kapi('f0'), 'gecildi');  // f0e sayesinde
});

test('kapı eşikleri müfredattan türetilir ve gerçekle uyuşur', () => {
  const bos = hesap(muf, bosDurum(), '2026-08-27');
  const e = bos.esikler();
  assert.equal(e.length, muf.phases.length);

  /* Her fazı ASGARİ şartla geçir, gerçek yüzdenin eşiğe eşit çıktığını gör.
     Bu, formülün "en ucuz maddeyi tavana çıkar" kuralını doğrular; eskiden
     "en pahalı" alınıyordu ve eşikler şişkindi. */
  const d = bosDurum();
  for (const p of muf.phases) {
    const fc = muf.items.filter(i => i.p === p.id && i.core);
    if (!fc.length) continue;
    for (const i of fc) basamakAta(d, i, esik(i), '2026-01-01');
    let ucuz = fc[0], enAz = Infinity;
    for (const i of fc) {
      const g = 1 - esik(i) / tavan(i);
      if (g < enAz) { enAz = g; ucuz = i; }
    }
    basamakAta(d, ucuz, tavan(ucuz), '2026-01-01');
    const h = hesap(muf, d, '2026-08-27');
    assert.equal(h.kapi(p.id), 'gecildi', p.id + ' kapısı asgari şartla geçmeli');
    const beklenen = e.find(x => x.id === p.id).pct;
    assert.equal(h.genel, Math.round(beklenen),
      p.id + ' eşiği ' + beklenen.toFixed(2) + ' ama gerçek ' + h.genel);
  }
});

test('eşik gerçekten ASGARİ: kaba kuvvet daha ucuz geçen bir dizilim bulamıyor', () => {
  /* Yukarıdaki test `esikler()`in kuralını tekrar ediyor — yani formülün
     ULAŞILABİLİR olduğunu gösterir, EN UCUZ olduğunu değil. İddia ise
     "kapının sağlanabileceği en düşük çekirdek yüzdesi". Burası o iddiayı
     formülden bağımsız sınar: fazın çekirdek maddelerine verilebilecek TÜM
     basamak kombinasyonlarını sayar, kapıyı geçenler arasındaki en küçük
     maliyeti bulur ve formülün payıyla karşılaştırır.
     En büyük faz 7 çekirdek madde × 5 basamak = 78.125 kombinasyon. */
  for (const p of muf.phases) {
    const fc = muf.items.filter(i => i.p === p.id && i.core);
    if (!fc.length) continue;

    let enUcuzKaba = Infinity;
    const gez = (k, atama) => {
      if (k === fc.length) {
        const hepsi = fc.every((i, j) => atama[j] >= esik(i));
        const biri = fc.some((i, j) => atama[j] >= tavan(i));
        if (!hepsi || !biri) return;
        let m = 0;
        fc.forEach((i, j) => { m += atama[j] / tavan(i); });
        if (m < enUcuzKaba) enUcuzKaba = m;
        return;
      }
      for (let v = 0; v <= tavan(fc[k]); v++) gez(k + 1, [...atama, v]);
    };
    gez(0, []);

    /* Formülün aynı faz için hesapladığı pay: kümülatif eşiklerin farkı. */
    const e = hesap(muf, bosDurum(), '2026-08-27').esikler();
    const cekirdekSayisi = muf.items.filter(i => i.core).length;
    const idx = e.findIndex(x => x.id === p.id);
    const pay = (e[idx].pct - (idx ? e[idx - 1].pct : 0)) * cekirdekSayisi / 100;

    assert.ok(Math.abs(pay - enUcuzKaba) < 1e-9,
      `${p.id}: formül payı ${pay.toFixed(4)}, kaba kuvvetin bulduğu asgari ${enUcuzKaba.toFixed(4)}`);
  }
});

test('kapı kuralının ikinci yarısı gerçekten iş yapıyor (f3 tanığı)', () => {
  /* Fazların çoğunda eşiği tavanına eşit en az bir çekirdek madde var, o
     yüzden "biri tavanda" şartı kendiliğinden sağlanıyor ve testte görünmez
     kalıyordu. FAZ 3'ün üç çekirdek maddesinin de tavanı eşiğinden yüksek:
     kuralın tek gerçek tanığı orası. */
  const f3 = muf.items.filter(i => i.p === 'f3' && i.core);
  assert.ok(f3.length && f3.every(i => esik(i) < tavan(i)),
    'f3 bu testin dayanağı: her çekirdek maddesinin tavanı eşiğinden yüksek olmalı');

  const d = bosDurum();
  for (const i of f3) basamakAta(d, i, esik(i), '2026-01-01');
  assert.equal(hesap(muf, d, '2026-08-27').kapi('f3'), 'suruyor',
    'hepsi eşikte ama biri tavanda değil → kapı geçilmemeli');

  basamakAta(d, f3[0], tavan(f3[0]), '2026-01-01');
  assert.equal(hesap(muf, d, '2026-08-27').kapi('f3'), 'gecildi');
});

test('sıradaki iş kapının İKİ şartını da güder — "bitti" derken kapı açık kalmaz', () => {
  /* Bir kez şöyleydi: bütün çekirdek maddeler tam eşiğe çekilince araç
     "tüm çekirdek maddeler eşiği geçti, kalanlar seçmeli" diyordu, oysa FAZ 3
     kapısı açıktı. Yani araç, müfredatın "en olası başarısızlık biçimi" ilan
     ettiği davranışa kendisi yönlendiriyordu. */
  const d = bosDurum();
  for (const i of muf.items.filter(i => i.core)) basamakAta(d, i, esik(i), '2026-01-01');
  const h = hesap(muf, d, '2026-08-27');

  assert.ok(h.sonraki, 'kapısı açık faz varken sıradaki iş boş olamaz');
  assert.equal(h.sonraki.p, 'f3');
  assert.equal(h.sonrakiHedef, tavan(h.sonraki), 'hedef tavan olmalı');
  assert.ok(h.kapiyaKalan('f3').length > 0, 'açık kapıda kalan iş 0 görünmemeli');

  /* Ve iş bitince gerçekten biter. */
  basamakAta(d, h.sonraki, tavan(h.sonraki), '2026-01-01');
  const h2 = hesap(muf, d, '2026-08-27');
  assert.equal(h2.sonraki, null);
  for (const p of muf.phases) {
    if (h2.kapi(p.id) === 'yok') continue;
    assert.equal(h2.kapi(p.id), 'gecildi', p.id + ' kapısı da geçilmiş olmalı');
  }
});

test('fazYuzdesi çekirdek tabanlıdır — "geçildi" yazan satırın çubuğu eksik kalmaz', () => {
  const d = bosDurum();
  for (const i of muf.items.filter(i => i.p === 'z' && i.core)) {
    basamakAta(d, i, tavan(i), '2026-01-01');
  }
  const h = hesap(muf, d, '2026-08-27');
  assert.equal(h.kapi('z'), 'gecildi');
  /* Seçmeli z3'e hiç dokunulmadı; yine de çubuk %100 olmalı, çünkü ölçü
     çekirdek. Eskiden %75 çıkıyordu ve satırda "geçildi" ile yan yana duruyordu. */
  assert.equal(h.fazYuzdesi('z'), 100);
});

test('son kapı %100 değildir — kalan pay 4. basamaktır', () => {
  const e = hesap(muf, bosDurum(), '2026-08-27').esikler();
  const son = e[e.length - 1].pct;
  assert.ok(son < 100, 'son kapı %100 olmamalı, çıktı: ' + son);
  assert.ok(son > 70, 'son kapı makul yükseklikte olmalı, çıktı: ' + son);
});

test('sıradaki iş müfredat sırasındaki ilk eşik-altı çekirdek maddedir', () => {
  const d = bosDurum();
  assert.equal(hesap(muf, d, '2026-08-27').sonraki.id, muf.items.find(i => i.core).id);
  for (const i of muf.items.filter(i => i.p === 'z' && i.core)) {
    basamakAta(d, i, esik(i), '2026-01-01');
  }
  assert.equal(hesap(muf, d, '2026-08-27').sonraki.p, 'f0');
});

test('haftalık saat penceresi sınırları doğru (gelecek hafta sızmaz)', () => {
  const d = durumOku({
    items: {},
    journal: [
      { date: '2026-08-23', hours: 5 },   // önceki hafta (Pazar)
      { date: '2026-08-24', hours: 2 },   // bu hafta (Pazartesi)
      { date: '2026-08-30', hours: 9 },   // bu haftanın Pazar'ı
      { date: '2026-08-31', hours: 4 }    // gelecek hafta
    ]
  }, muf);
  const h = hesap(muf, d, '2026-08-27');
  assert.equal(h.buHafta, 11);            // 2 + 9
  assert.equal(h.toplamSaat, 20);
});

test('son "yarın ilk iş" notu en son yazılandır', () => {
  const d = durumOku({
    items: {},
    journal: [
      { date: '2026-08-20', hours: 2, yarin: 'eski not' },
      { date: '2026-08-24', hours: 2, yarin: 'yeni not' },
      { date: '2026-08-26', hours: 2 }        // yarın yok: öncekini korur
    ]
  }, muf);
  assert.equal(hesap(muf, d, '2026-08-27').sonYarin.yarin, 'yeni not');
});

test('boş durumda hiçbir şey patlamaz', () => {
  const h = hesap(muf, bosDurum(), '2026-08-27');
  assert.equal(h.genel, 0);
  assert.equal(h.buHafta, 0);
  assert.equal(h.sonYarin, null);
  assert.equal(h.gunOldu, null);
  assert.equal(h.kapi('z'), 'baslamadi');
  assert.ok(h.esikler().length > 0);
});
