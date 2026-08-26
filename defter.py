#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM Atölye Defteri — müstakil takip aracı.

Veri tek kaynakta yaşar: durum.json (git ile izlenir).
Müfredat mufredat.json'dadır. Site (index/defter/fazlar) aynı iki dosyayı
tarayıcıda okur; bu betik terminal tarafıdır. İlerleme matematiğinin JS
ikizi atolye.js'tedir — biri değişirse diğeri de değişmeli
(./capraz-test.sh ikisini karşılaştırır).

Komutlar:
  atolye                                   # bugün ne yapmalıyım
  atolye durum | rapor | liste [faz]
  atolye seviye f0a 3 [-y]                 # ustalık basamağı ata (+ yayınla)
  atolye seans --saat 2.5 --faz f0 --yaptim "..." [-y]
  atolye yayinla                           # commit + push
  atolye ice-aktar yedek.json              # dış yedeği durum.json yap
"""
import argparse
import datetime as dt
import json
import math
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
MUFREDAT_YOLU = ROOT / "mufredat.json"
DURUM_YOLU = ROOT / "durum.json"

TARIH_DESENI = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------------- müfredat ----------------

def mufredat_yukle():
    m = json.loads(MUFREDAT_YOLU.read_text(encoding="utf-8"))
    m["by_id"] = {it["id"]: it for it in m["items"]}
    return m


def tavan(it):
    return it.get("max", 4 if it["t"] == "yap" else 2)


def gecis_esigi(it):
    return min(3 if it["t"] == "yap" else 2, tavan(it))


def basamak_adlari(m, it):
    return m["levels"][it["t"]][: tavan(it) + 1]


# ---------------- durum ----------------

def bos_durum():
    return {"v": 2, "items": {}, "olaylar": [], "journal": [], "updated": None}


def basamak_oku(ham, it):
    """Basamağı iki şemadan da oku: v1 {id: 3} ve v2 {id: {"n":3,"t":"..."}}."""
    if isinstance(ham, dict):
        try:
            n = int(ham.get("n"))
        except (TypeError, ValueError):
            return None
        t = ham.get("t")
        t = t if isinstance(t, str) and TARIH_DESENI.match(t) else None
    else:
        try:
            n = int(ham)
        except (TypeError, ValueError):
            return None
        t = None
    if n <= 0:
        return None
    return {"n": min(n, tavan(it)), "t": t}


def sev(d, mid):
    """Maddenin güncel basamağı (yoksa 0)."""
    b = d["items"].get(mid)
    if not b:
        return 0
    n = b["n"] if isinstance(b, dict) else b
    return n if n and n > 0 else 0


def sev_tarih(d, mid):
    """Basamağın kazanıldığı gün; v1 verisinde bilinmez → None."""
    b = d["items"].get(mid)
    return b.get("t") if isinstance(b, dict) else None


def basamak_ata(d, it, n, bugun=None):
    """Tek yazma yolu: izdüşüm (items) ve günlük (olaylar) birlikte yazılır.
    atolye.js'teki basamakAta ile aynı davranmak ZORUNDA."""
    gun = bugun or dt.date.today().isoformat()
    n = max(0, min(int(n), tavan(it)))
    if n == sev(d, it["id"]):
        return False
    if n == 0:
        d["items"].pop(it["id"], None)
    else:
        d["items"][it["id"]] = {"n": n, "t": gun}
    d.setdefault("olaylar", []).append({"d": gun, "id": it["id"], "n": n})
    return True


def tazele_madde(d, it, bugun=None):
    """Aynı basamağı yeniden onayla: sayı sabit, saat sıfırlanır."""
    n = sev(d, it["id"])
    if not n:
        return False
    gun = bugun or dt.date.today().isoformat()
    d["items"][it["id"]] = {"n": n, "t": gun}
    d.setdefault("olaylar", []).append({"d": gun, "id": it["id"], "n": n})
    return True


def normallestir(ham, m):
    if not isinstance(ham, dict):
        return None
    out = bos_durum()
    if isinstance(ham.get("updated"), str):
        out["updated"] = ham["updated"]
    items = ham.get("items")
    if isinstance(items, dict):
        for k, v in items.items():
            it = m["by_id"].get(k)
            if it is None:
                continue
            b = basamak_oku(v, it)
            if b:
                out["items"][k] = b
    olaylar = ham.get("olaylar")
    if isinstance(olaylar, list):
        for o in olaylar:
            if not isinstance(o, dict):
                continue
            it = m["by_id"].get(o.get("id"))
            if it is None or not TARIH_DESENI.match(str(o.get("d"))):
                continue
            try:
                n = int(o.get("n"))
            except (TypeError, ValueError):
                continue
            if n < 0:
                continue
            out["olaylar"].append({"d": o["d"], "id": o["id"], "n": min(n, tavan(it))})
        out["olaylar"].sort(key=lambda x: x["d"])
    kayitlar = ham.get("journal")
    if isinstance(kayitlar, list):
        for e in kayitlar:
            if not isinstance(e, dict):
                continue
            tarih = e.get("date")
            if not (isinstance(tarih, str) and TARIH_DESENI.match(tarih)):
                continue
            try:
                saat = float(e.get("hours") or 0)
            except (TypeError, ValueError):
                saat = 0.0
            out["journal"].append({
                "id": str(e.get("id") or f"j{len(out['journal'])}"),
                "date": tarih,
                "hours": saat if saat > 0 else 0,
                "phase": e.get("phase") if isinstance(e.get("phase"), str) else "z",
                "yaptim": str(e.get("yaptim") or ""),
                "ogrendim": str(e.get("ogrendim") or ""),
                "anlamadim": str(e.get("anlamadim") or ""),
                "yarin": str(e.get("yarin") or ""),
            })
    return out


def durum_yukle(m):
    if not DURUM_YOLU.exists():
        return bos_durum()
    try:
        ham = json.loads(DURUM_YOLU.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"HATA: durum.json bozuk ({e}). Elle düzelt ya da ice-aktar kullan.")
    d = normallestir(ham, m)
    return d if d is not None else bos_durum()


def durum_kaydet(d):
    d["updated"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    DURUM_YOLU.write_text(
        json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )



def yuvarla(x):
    """JS Math.round ile AYNI davranış (yarımı yukarı).
    Python'un yerleşik round()'u bankacı yuvarlaması yapar: round(12.5)==12
    ama Math.round(12.5)==13. İki uygulama bu yüzden sessizce ayrışıyordu;
    yüzde hesaplarında hep bunu kullan. (Değerler negatif olmadığı için
    floor(x+0.5) yeterli.)"""
    return math.floor(x + 0.5)


# ---------------- hesaplar ----------------

def faz_maddeleri(m, pid):
    return [it for it in m["items"] if it["p"] == pid]


def faz_yuzdesi(m, d, pid):
    its = faz_maddeleri(m, pid)
    if not its:
        return 0
    s = sum(sev(d, it["id"]) / tavan(it) for it in its)
    return yuvarla(100 * s / len(its))


def kapi_durumu(m, d, pid):
    cekirdek = [it for it in faz_maddeleri(m, pid) if it.get("core")]
    hepsi_gecti = all(sev(d, it["id"]) >= gecis_esigi(it) for it in cekirdek)
    biri_tavanda = any(sev(d, it["id"]) >= tavan(it) for it in cekirdek)
    if hepsi_gecti and biri_tavanda:
        return "GEÇİLDİ"
    if any(sev(d, it["id"]) > 0 for it in faz_maddeleri(m, pid)):
        return "sürüyor"
    return "başlamadı"


def genel_yuzde(m, d):
    cekirdek = [it for it in m["items"] if it.get("core")]
    s = sum(sev(d, it["id"]) / tavan(it) for it in cekirdek)
    return yuvarla(100 * s / len(cekirdek))


def hafta_baslangici(gun=None):
    gun = gun or dt.date.today()
    return gun - dt.timedelta(days=gun.weekday())


def bu_hafta_saat(d):
    p = hafta_baslangici()
    toplam = 0.0
    for e in d["journal"]:
        try:
            g = dt.date.fromisoformat(e["date"])
        except ValueError:
            continue
        if p <= g <= p + dt.timedelta(days=6):
            toplam += e["hours"]
    return toplam


def toplam_saat(d):
    return sum(e["hours"] for e in d["journal"])


def hafta_saatleri(d, hafta_sayisi=8):
    """Son N ISO haftasının saat toplamı: [(hafta_baslangici, saat), ...] eskiden yeniye."""
    bu = hafta_baslangici()
    kovalar = {bu - dt.timedelta(weeks=i): 0.0 for i in range(hafta_sayisi)}
    for e in d["journal"]:
        try:
            g = dt.date.fromisoformat(e["date"])
        except ValueError:
            continue
        hb = hafta_baslangici(g)
        if hb in kovalar:
            kovalar[hb] += e["hours"]
    return sorted(kovalar.items())



def ilerleme_serisi(m, d, hafta_sayisi, bugun=None):
    """Çekirdek yüzdesinin zaman içindeki seyri; kaynak olay günlüğü.
    Günlük yoksa None döner — düz çizgi uydurulmaz.
    atolye.js'teki ilerlemeSerisi ile aynı sonucu vermek ZORUNDA."""
    olaylar = d.get("olaylar") or []
    if not olaylar:
        return None
    cekirdek = [i for i in m["items"] if i.get("core")]
    if not cekirdek:
        return None
    bugun = dt.date.fromisoformat(bugun) if bugun else dt.date.today()
    base = hafta_baslangici(bugun)
    sinirlar = [base - dt.timedelta(weeks=i) + dt.timedelta(days=6)
                for i in range(hafta_sayisi - 1, -1, -1)]
    seviye, oi, cikti = {}, 0, []
    for son in sinirlar:
        son_key = son.isoformat()
        while oi < len(olaylar) and olaylar[oi]["d"] <= son_key:
            o = olaylar[oi]
            if o["n"] > 0:
                seviye[o["id"]] = o["n"]
            else:
                seviye.pop(o["id"], None)
            oi += 1
        toplam = sum(min(seviye.get(it["id"], 0), tavan(it)) / tavan(it) for it in cekirdek)
        cikti.append({"hafta": hafta_baslangici(son).isoformat(),
                      "son": son_key,
                      "pct": yuvarla(100 * toplam / len(cekirdek))})
    return cikti


def haftalik_kazanc(m, d, hafta_sayisi=12, bugun=None):
    """Haftalık çekirdek-yüzde kazancı; içinde bulunulan yarım hafta hariç."""
    seri = ilerleme_serisi(m, d, hafta_sayisi + 1, bugun)
    if not seri or len(seri) < 2:
        return None
    out = [max(0, seri[i]["pct"] - seri[i - 1]["pct"]) for i in range(1, len(seri) - 1)]
    return out or None


def sonraki_madde(m, d):
    """Sıradaki çekirdek madde: en düşük fazda, eşiği geçmemiş ilk çekirdek."""
    for it in m["items"]:
        if it.get("core") and sev(d, it["id"]) < gecis_esigi(it):
            return it
    return None


def faz_sayfasi(pid):
    """Faz kimliği → haftalık plan sayfası. Kimlikler f0..f5, dosyalar faz0..faz5."""
    return "fazlar/zemin.html" if pid == "z" else f"fazlar/faz{str(pid)[1:]}.html"


def faz_adi(m, pid):
    for p in m["phases"]:
        if p["id"] == pid:
            return p["tag"] + " — " + p["name"]
    return pid


# ---------------- git ----------------

def git(*argv, sessiz=False):
    """Depoda git komutu koştur; (basarili, cikti) döndür."""
    try:
        r = subprocess.run(["git", *argv], cwd=ROOT, capture_output=True,
                           text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)
    cikti = (r.stdout + r.stderr).strip()
    if r.returncode != 0 and not sessiz:
        return False, cikti
    return r.returncode == 0, cikti


def git_var():
    return (ROOT / ".git").exists()


# ---------------- komutlar ----------------

def cubuk(pct, genislik=20):
    dolu = round(genislik * pct / 100)
    return "█" * dolu + "░" * (genislik - dolu)


def cmd_durum(m, d, _args):
    print(f"\nLLM Atölye Defteri — {dt.date.today().isoformat()}")
    print(f"Çekirdek ilerleme: %{genel_yuzde(m, d)}   "
          f"Bu hafta: {bu_hafta_saat(d):g} sa (hedef 8–10)   "
          f"Toplam: {toplam_saat(d):g} sa / {len(d['journal'])} seans\n")
    for p in m["phases"]:
        pct = faz_yuzdesi(m, d, p["id"])
        kapi = kapi_durumu(m, d, p["id"])
        print(f"{p['tag']:<6} {cubuk(pct)} %{pct:<4} {kapi:<10} {p['name']}")
    acik = [it for it in m["items"]
            if it.get("core") and sev(d, it["id"]) < gecis_esigi(it)]
    if acik:
        ilk = acik[0]
        adlar = basamak_adlari(m, ilk)
        simdiki = sev(d, ilk["id"])
        print(f"\nSıradaki çekirdek madde: [{ilk['id']}] {ilk['lbl']}"
              f" — şu an: {adlar[simdiki]}")
    son = max((e["date"] for e in d["journal"]), default=None)
    if son:
        print(f"Son seans: {son}")
    print()


def cmd_liste(m, d, args):
    for p in m["phases"]:
        if args.faz and p["id"] != args.faz:
            continue
        print(f"\n{p['tag']} — {p['name']}")
        for it in faz_maddeleri(m, p["id"]):
            adlar = basamak_adlari(m, it)
            sev = sev(d, it["id"])
            isaret = "Ç" if it.get("core") else " "
            print(f"  [{it['id']:<4}] {isaret} {sev}/{tavan(it)} {adlar[sev]:<22} {it['lbl']}")
    print()


def cmd_seviye(m, d, args):
    it = m["by_id"].get(args.madde)
    if it is None:
        sys.exit(f"HATA: bilinmeyen madde '{args.madde}'. Kimlikler için: python3 defter.py liste")
    if not (0 <= args.basamak <= tavan(it)):
        sys.exit(f"HATA: {args.madde} için basamak 0–{tavan(it)} arası olmalı.")
    if not basamak_ata(d, it, args.basamak):
        print(f"{it['lbl']} zaten {args.basamak}. basamakta — değişiklik yok.")
        return
    durum_kaydet(d)
    adlar = basamak_adlari(m, it)
    print(f"{it['lbl']} → {args.basamak} ({adlar[args.basamak]})")
    kapi = kapi_durumu(m, d, it["p"])
    if kapi == "GEÇİLDİ":
        print(f"🎉 {faz_adi(m, it['p'])} kapısı GEÇİLDİ.")
    belki_yayinla(m, d, args, f"defter: {args.madde} → {args.basamak} ({adlar[args.basamak]})")


def cmd_seans(m, d, args):
    tarih = args.tarih or dt.date.today().isoformat()
    if not TARIH_DESENI.match(tarih):
        sys.exit("HATA: tarih YYYY-MM-DD biçiminde olmalı.")
    if not args.yaptim and not args.saat:
        sys.exit("HATA: en azından --yaptim ya da --saat ver.")
    if args.faz and args.faz not in {p["id"] for p in m["phases"]}:
        sys.exit(f"HATA: bilinmeyen faz '{args.faz}'.")
    kimlikler = {e["id"] for e in d["journal"]}
    n = len(d["journal"])
    while f"j{n}" in kimlikler:
        n += 1
    d["journal"].append({
        "id": f"j{n}", "date": tarih, "hours": args.saat or 0,
        "phase": args.faz or "z",
        "yaptim": args.yaptim or "", "ogrendim": args.ogrendim or "",
        "anlamadim": args.anlamadim or "", "yarin": args.yarin or "",
    })
    durum_kaydet(d)
    print(f"Seans kaydedildi: {tarih}, {args.saat or 0:g} sa. "
          f"Bu hafta toplam: {bu_hafta_saat(d):g} sa.")
    belki_yayinla(m, d, args, f"seans: {tarih} ({args.saat or 0:g} sa)"
                              + (f" — {args.yaptim[:60]}" if args.yaptim else ""))


def yayinla(m, d, mesaj):
    """durum.json'u commit'le ve push'la; site kendini günceller."""
    if not git_var():
        print("Not: burası bir git deposu değil — yalnızca dosyalar güncellendi.")
        return False
    ok, _ = git("add", "durum.json")
    if not ok:
        print("UYARI: git add başarısız.")
        return False
    ok, cikti = git("diff", "--cached", "--quiet", sessiz=True)
    if ok:  # returncode 0 → değişiklik yok
        print("Değişiklik yok; yayınlanacak bir şey bulunamadı.")
        return False
    ok, cikti = git("commit", "-m", mesaj)
    if not ok:
        print(f"UYARI: commit başarısız:\n{cikti}")
        return False
    ok, cikti = git("push")
    if not ok:
        print(f"UYARI: push başarısız (commit yerelde duruyor):\n{cikti}")
        return False
    print("✓ Yayınlandı → site birkaç dakika içinde güncellenir.")
    return True


def belki_yayinla(m, d, args, mesaj):
    if getattr(args, "yayinla", False):
        yayinla(m, d, mesaj)


def cmd_yayinla(m, d, args):
    mesaj = args.mesaj or f"defter: {dt.date.today().isoformat()} güncelleme"
    yayinla(m, d, mesaj)


def cmd_bugun(m, d, _args):
    bugun = dt.date.today()
    print(f"\n📌 {bugun.isoformat()} — bugün ne yapmalıyım?\n")

    it = sonraki_madde(m, d)
    if it is None:
        print("Tüm çekirdek maddeler eşiği geçti. 🎉 Kalanlar seçmeli.\n")
    else:
        adlar = basamak_adlari(m, it)
        sev = sev(d, it["id"])
        hedef = gecis_esigi(it)
        print(f"  SIRADAKİ  [{it['id']}] {it['lbl']}")
        print(f"            şu an: {adlar[sev]}  →  hedef: {adlar[hedef]}")
        if it.get("hint"):
            print(f"            ipucu: {it['hint']}")
        sayfa = faz_sayfasi(it["p"])
        print(f"            plan:  {sayfa}")
        print(f"            işle:  python3 defter.py seviye {it['id']} {sev + 1} -y")

    hedef_saat = 9.0
    bu = bu_hafta_saat(d)
    kalan_gun = 7 - bugun.weekday()
    print(f"\n  BU HAFTA  {bu:g} / {hedef_saat:g} sa"
          f"  ({'hedef doldu ✓' if bu >= hedef_saat else f'{hedef_saat - bu:g} sa kaldı, {kalan_gun} gün var'})")

    son = max((e["date"] for e in d["journal"]), default=None)
    if son:
        try:
            fark = (bugun - dt.date.fromisoformat(son)).days
            if fark == 0:
                print("  SON SEANS bugün ✓")
            elif fark == 1:
                print("  SON SEANS dün")
            else:
                print(f"  SON SEANS {fark} gün önce ({son})"
                      + ("  — girişi küçült: 30 dk'lık bir blok yeter." if fark >= 7 else ""))
        except ValueError:
            pass
    else:
        print("  SON SEANS yok — ilk seansı bugün aç.")

    acik = [e for e in d["journal"] if e.get("anlamadim")]
    if acik:
        print("\n  AÇIK SORULAR (son 3):")
        for e in sorted(acik, key=lambda x: x["date"])[-3:]:
            print(f"    · {e['anlamadim']}  ({e['date']})")
    print()


def cmd_rapor(m, d, args):
    hafta = args.hafta or 8
    print(f"\n📊 Haftalık rapor — {dt.date.today().isoformat()}\n")
    print(f"Çekirdek ilerleme: %{genel_yuzde(m, d)}   "
          f"Toplam: {toplam_saat(d):g} sa / {len(d['journal'])} seans\n")

    seri = hafta_saatleri(d, hafta)
    en_cok = max((s for _, s in seri), default=0) or 1
    print(f"Son {hafta} hafta:")
    for hb, sa in seri:
        dolu = round(24 * sa / en_cok)
        isaret = "◀ bu hafta" if hb == hafta_baslangici() else ""
        print(f"  {hb.isoformat()}  {'█' * dolu}{'·' * (24 - dolu)} {sa:>5.1f} sa {isaret}")

    calisilan = [sa for _, sa in seri if sa > 0]
    if calisilan:
        print(f"\n  Çalışılan hafta ortalaması: {sum(calisilan) / len(calisilan):.1f} sa "
              f"({len(calisilan)}/{hafta} hafta aktif)")

    gunler = {}
    for e in d["journal"]:
        try:
            g = dt.date.fromisoformat(e["date"])
        except ValueError:
            continue
        gunler[g.weekday()] = gunler.get(g.weekday(), 0) + e["hours"]
    if gunler:
        adlar = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]
        en_iyi = max(gunler.items(), key=lambda kv: kv[1])
        print(f"  En verimli gün: {adlar[en_iyi[0]]} (toplam {en_iyi[1]:g} sa)")

    print("\nFaz durumu:")
    for p in m["phases"]:
        pct = faz_yuzdesi(m, d, p["id"])
        kapi = kapi_durumu(m, d, p["id"])
        cekirdek = [i for i in faz_maddeleri(m, p["id"]) if i.get("core")]
        eksik = [i for i in cekirdek if sev(d, i["id"]) < gecis_esigi(i)]
        ek = f"kapıya {len(eksik)} madde" if eksik and pct > 0 else ""
        print(f"  {p['tag']:<6} {cubuk(pct)} %{pct:<4} {kapi:<10} {ek}")

    ogrenilen = [e for e in d["journal"] if e.get("ogrendim")]
    if ogrenilen:
        print("\nSon öğrendiklerin:")
        for e in sorted(ogrenilen, key=lambda x: x["date"])[-5:]:
            print(f"  · {e['ogrendim']}  ({e['date']})")
    print()


def cmd_ice_aktar(m, d, args):
    kaynak = pathlib.Path(args.dosya)
    if not kaynak.exists():
        sys.exit(f"HATA: {kaynak} yok.")
    try:
        ham = json.loads(kaynak.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"HATA: geçersiz JSON ({e}).")
    yeni = normallestir(ham, m)
    if yeni is None:
        sys.exit("HATA: dosya bir durum nesnesi değil.")
    if DURUM_YOLU.exists():
        yedek = ROOT / "durum.onceki.json"
        yedek.write_text(DURUM_YOLU.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Önceki durum yedeklendi: {yedek.name}")
    durum_kaydet(yeni)
    print(f"İçe aktarıldı: {len(yeni['items'])} madde seviyesi, "
          f"{len(yeni['journal'])} seans. (Geçersiz kayıtlar ayıklandı.)")


def main():
    ap = argparse.ArgumentParser(description="LLM Atölye Defteri")
    alt = ap.add_subparsers(dest="komut")

    alt.add_parser("durum", help="terminal panosu")
    alt.add_parser("bugun", help="sıradaki iş + haftalık durum + açık sorular")

    p = alt.add_parser("rapor", help="haftalık retro raporu")
    p.add_argument("--hafta", type=int, default=8, help="kaç hafta geriye (varsayılan 8)")

    p = alt.add_parser("liste", help="madde kimlikleri")
    p.add_argument("faz", nargs="?", help="yalnızca bu faz (z, f0..f5)")

    p = alt.add_parser("seviye", help="ustalık basamağı ata")
    p.add_argument("madde")
    p.add_argument("basamak", type=int)
    p.add_argument("-y", "--yayinla", action="store_true", help="kaydet + commit + push")

    p = alt.add_parser("seans", help="seans günlüğüne kayıt ekle")
    p.add_argument("--saat", type=float, default=0)
    p.add_argument("--faz", default="")
    p.add_argument("--tarih", default="")
    p.add_argument("--yaptim", default="")
    p.add_argument("--ogrendim", default="")
    p.add_argument("--anlamadim", default="")
    p.add_argument("--yarin", default="")
    p.add_argument("-y", "--yayinla", action="store_true", help="kaydet + commit + push")

    p = alt.add_parser("yayinla", help="durum.json commit + push")
    p.add_argument("-m", "--mesaj", default="")

    p = alt.add_parser("ice-aktar", help="dış yedeği durum.json yap")
    p.add_argument("dosya")

    args = ap.parse_args()
    if not args.komut:
        ap.print_help()
        return
    m = mufredat_yukle()
    d = durum_yukle(m)
    {"durum": cmd_durum, "bugun": cmd_bugun, "rapor": cmd_rapor,
     "liste": cmd_liste, "seviye": cmd_seviye, "seans": cmd_seans,
     "yayinla": cmd_yayinla,
     "ice-aktar": cmd_ice_aktar}[args.komut](m, d, args)

if __name__ == "__main__":
    main()
