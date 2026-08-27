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
