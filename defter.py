#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM Atölye Defteri — müstakil takip aracı.

Veri tek kaynakta yaşar: durum.json (git ile izlenir).
Müfredat mufredat.json'dadır. Bu betik hem terminal panosu hem de
kendi kendine yeten bir HTML defter (defter.html) üretir.

Komutlar:
  python3 defter.py durum                  # terminal panosu
  python3 defter.py liste [faz]            # madde kimlikleri
  python3 defter.py seviye f0a 3           # ustalık basamağı ata
  python3 defter.py seans --saat 2.5 --faz f0 --yaptim "..." \
        [--ogrendim ...] [--anlamadim ...] [--yarin ...] [--tarih YYYY-MM-DD]
  python3 defter.py html                   # defter.html'i yeniden üret
  python3 defter.py ice-aktar yedek.json   # dış yedeği durum.json yap
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
MUFREDAT_YOLU = ROOT / "mufredat.json"
DURUM_YOLU = ROOT / "durum.json"
HTML_YOLU = ROOT / "defter.html"

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
    return {"v": 1, "items": {}, "journal": [], "updated": None}


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
            try:
                v = int(v)
            except (TypeError, ValueError):
                continue
            if v > 0:
                out["items"][k] = min(v, tavan(it))
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


# ---------------- hesaplar ----------------

def faz_maddeleri(m, pid):
    return [it for it in m["items"] if it["p"] == pid]


def faz_yuzdesi(m, d, pid):
    its = faz_maddeleri(m, pid)
    if not its:
        return 0
    s = sum(d["items"].get(it["id"], 0) / tavan(it) for it in its)
    return round(100 * s / len(its))


def kapi_durumu(m, d, pid):
    cekirdek = [it for it in faz_maddeleri(m, pid) if it.get("core")]
    hepsi_gecti = all(d["items"].get(it["id"], 0) >= gecis_esigi(it) for it in cekirdek)
    biri_tavanda = any(d["items"].get(it["id"], 0) >= tavan(it) for it in cekirdek)
    if hepsi_gecti and biri_tavanda:
        return "GEÇİLDİ"
    if any(d["items"].get(it["id"], 0) > 0 for it in faz_maddeleri(m, pid)):
        return "sürüyor"
    return "başlamadı"


def genel_yuzde(m, d):
    cekirdek = [it for it in m["items"] if it.get("core")]
    s = sum(d["items"].get(it["id"], 0) / tavan(it) for it in cekirdek)
    return round(100 * s / len(cekirdek))


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
            if it.get("core") and d["items"].get(it["id"], 0) < gecis_esigi(it)]
    if acik:
        ilk = acik[0]
        adlar = basamak_adlari(m, ilk)
        simdiki = d["items"].get(ilk["id"], 0)
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
            sev = d["items"].get(it["id"], 0)
            isaret = "Ç" if it.get("core") else " "
            print(f"  [{it['id']:<4}] {isaret} {sev}/{tavan(it)} {adlar[sev]:<22} {it['lbl']}")
    print()


def cmd_seviye(m, d, args):
    it = m["by_id"].get(args.madde)
    if it is None:
        sys.exit(f"HATA: bilinmeyen madde '{args.madde}'. Kimlikler için: python3 defter.py liste")
    if not (0 <= args.basamak <= tavan(it)):
        sys.exit(f"HATA: {args.madde} için basamak 0–{tavan(it)} arası olmalı.")
    if args.basamak == 0:
        d["items"].pop(args.madde, None)
    else:
        d["items"][args.madde] = args.basamak
    durum_kaydet(d)
    adlar = basamak_adlari(m, it)
    print(f"{it['lbl']} → {args.basamak} ({adlar[args.basamak]})")
    kapi = kapi_durumu(m, d, it["p"])
    if kapi == "GEÇİLDİ":
        print(f"🎉 {it['p']} kapısı GEÇİLDİ.")


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


def cmd_html(m, d, args):
    def json_gom(v):
        return json.dumps(v, ensure_ascii=False).replace("<", "\\u003c")

    gomulecek = {k: v for k, v in m.items() if k != "by_id"}
    html = (SABLON
            .replace("__MUFREDAT_JSON__", json_gom(gomulecek))
            .replace("__STATE_JSON__", json_gom(d))
            .replace("__URETIM__", dt.datetime.now().astimezone().isoformat(timespec="seconds")))
    hedef = pathlib.Path(args.cikti) if args.cikti else HTML_YOLU
    hedef.write_text(html, encoding="utf-8")
    print(f"Yazıldı: {hedef}  (tarayıcıda aç; değişiklikleri 'durum.json indir' ile depoya taşı)")


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

    p = alt.add_parser("liste", help="madde kimlikleri")
    p.add_argument("faz", nargs="?", help="yalnızca bu faz (z, f0..f5)")

    p = alt.add_parser("seviye", help="ustalık basamağı ata")
    p.add_argument("madde")
    p.add_argument("basamak", type=int)

    p = alt.add_parser("seans", help="seans günlüğüne kayıt ekle")
    p.add_argument("--saat", type=float, default=0)
    p.add_argument("--faz", default="")
    p.add_argument("--tarih", default="")
    p.add_argument("--yaptim", default="")
    p.add_argument("--ogrendim", default="")
    p.add_argument("--anlamadim", default="")
    p.add_argument("--yarin", default="")

    p = alt.add_parser("html", help="defter.html üret")
    p.add_argument("-o", "--cikti", default="")

    p = alt.add_parser("ice-aktar", help="dış yedeği durum.json yap")
    p.add_argument("dosya")

    args = ap.parse_args()
    if not args.komut:
        ap.print_help()
        return
    m = mufredat_yukle()
    d = durum_yukle(m)
    {"durum": cmd_durum, "liste": cmd_liste, "seviye": cmd_seviye,
     "seans": cmd_seans, "html": cmd_html, "ice-aktar": cmd_ice_aktar}[args.komut](m, d, args)


# ---------------- HTML şablonu ----------------
# defter.html tamamen kendi kendine yeter: müfredat + durum gömülüdür,
# değişiklikler tarayıcıda (localStorage) saklanır ve "durum.json indir"
# düğmesiyle depoya taşınır. Hiçbir dış servise bağımlılık yoktur.

SABLON = r'''<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LLM Atölye Defteri</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style id="appcss">
  :root {
    --bg: #f6f9f8; --surface: #ffffff; --surface-2: #eef4f2;
    --text: #1a2523; --muted: #566762; --line: #dbe5e1;
    --accent: #1e7d78; --accent-ink: #135b57; --code-bg: #eaf1ef;
    --warn: #b3591a; --ok: #1e7d78;
    --fz: #5f6f6a; --f0: #440154; --f1: #414487; --f2: #2a788e;
    --f3: #22a884; --f4: #7ad151; --f5: #e3ce1f;
    --badge-ink-dark: #1a2418;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0f1715; --surface: #17211e; --surface-2: #1d2926;
      --text: #e5edea; --muted: #97a8a2; --line: #26332f;
      --accent: #4cc0a9; --accent-ink: #6fd3bf; --code-bg: #1d2926;
      --warn: #e08b4a; --ok: #4cc0a9; --f5: #fde725;
      --f0: #8a4ba0; --f1: #6674cc;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0f1715; --surface: #17211e; --surface-2: #1d2926;
    --text: #e5edea; --muted: #97a8a2; --line: #26332f;
    --accent: #4cc0a9; --accent-ink: #6fd3bf; --code-bg: #1d2926;
    --warn: #e08b4a; --ok: #4cc0a9; --f5: #fde725;
    --f0: #8a4ba0; --f1: #6674cc;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text); margin: 0;
    font-family: "Source Serif 4", Georgia, serif;
    font-size: 1rem; line-height: 1.55;
  }
  .wrap { max-width: 47rem; margin: 0 auto; padding: 2rem 1.1rem 7rem; }
  h1, h2, h3 { font-family: "Bricolage Grotesque", "Helvetica Neue", sans-serif; line-height: 1.15; text-wrap: balance; }
  h1 { font-size: clamp(1.7rem, 5vw, 2.4rem); font-weight: 800; margin: 0.3rem 0 0.4rem; }
  h2 { font-size: 1.25rem; font-weight: 700; margin: 2.2rem 0 0.7rem; }
  a { color: var(--accent); }
  .kicker { font-family: "IBM Plex Mono", monospace; font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .lede { color: var(--muted); margin-top: 0.2rem; font-size: 0.98rem; }
  code, .mono { font-family: "IBM Plex Mono", monospace; font-size: 0.85em; background: var(--code-bg); border-radius: 4px; padding: 0.06em 0.3em; }
  .dash { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 0.6rem; margin: 1.2rem 0; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 0.7rem 0.9rem; }
  .stat .v { font-family: "IBM Plex Mono", monospace; font-size: 1.35rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat .l { font-size: 0.78rem; color: var(--muted); }
  .stat .sub { font-family: "IBM Plex Mono", monospace; font-size: 0.68rem; color: var(--muted); }
  .allbars { display: flex; gap: 0.35rem; margin: 0.4rem 0 0.2rem; }
  .allbars .pb { flex: 1; height: 0.55rem; border-radius: 4px; background: var(--surface-2); overflow: hidden; position: relative; }
  .allbars .pb i { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
  .pcard { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--pc); border-radius: 0 12px 12px 0; margin: 1rem 0; overflow: hidden; }
  .phead { display: flex; align-items: center; gap: 0.7rem; padding: 0.8rem 1rem; cursor: pointer; user-select: none; }
  .phead:hover { background: var(--surface-2); }
  .phead .tag { font-family: "IBM Plex Mono", monospace; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em; padding: 0.15em 0.6em; border-radius: 999px; background: var(--pc); color: #fff; flex-shrink: 0; }
  .phead .tag.inkdark { color: var(--badge-ink-dark); }
  .phead .nm { font-family: "Bricolage Grotesque", sans-serif; font-weight: 650; font-size: 1.02rem; flex: 1; min-width: 8rem; }
  .gate { font-family: "IBM Plex Mono", monospace; font-size: 0.66rem; padding: 0.2em 0.6em; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .gate.on { border-color: var(--ok); color: var(--ok); font-weight: 600; }
  .gate.run { border-color: var(--warn); color: var(--warn); }
  .ppct { font-family: "IBM Plex Mono", monospace; font-size: 0.72rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .chev { color: var(--muted); font-size: 0.8rem; }
  .open .chev { transform: rotate(90deg); }
  .pbody { display: none; border-top: 1px solid var(--line); }
  .open .pbody { display: block; }
  .item { padding: 0.7rem 1rem; border-bottom: 1px solid var(--line); }
  .item:last-child { border-bottom: none; }
  .item .row { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
  .item .lbl { flex: 1; min-width: 12rem; font-size: 0.95rem; }
  .item .core { font-family: "IBM Plex Mono", monospace; font-size: 0.62rem; color: var(--muted); border: 1px dashed var(--line); border-radius: 4px; padding: 0 0.3em; vertical-align: middle; }
  .item .hint { font-size: 0.82rem; color: var(--muted); margin: 0.15rem 0 0.3rem; }
  .lvls { display: flex; gap: 0.25rem; align-items: center; }
  .lvls button {
    font-family: "IBM Plex Mono", monospace; font-size: 0.72rem; font-weight: 600;
    width: 1.75rem; height: 1.55rem; border-radius: 5px; border: 1px solid var(--line);
    background: var(--surface-2); color: var(--muted); cursor: pointer; padding: 0;
  }
  .lvls button:hover { border-color: var(--pc); }
  .lvls button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .lvls button.hit { background: var(--pc); border-color: var(--pc); color: #fff; }
  .lvls button.hit.inkdark { color: var(--badge-ink-dark); }
  .lvlname { font-family: "IBM Plex Mono", monospace; font-size: 0.68rem; color: var(--muted); margin-top: 0.25rem; }
  .jform { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.1rem; }
  .jgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.6rem; margin-bottom: 0.6rem; }
  .jform label { display: block; font-family: "IBM Plex Mono", monospace; font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.2rem; }
  .jform input, .jform select, .jform textarea {
    width: 100%; border: 1px solid var(--line); border-radius: 7px; background: var(--bg);
    color: var(--text); font-family: "Source Serif 4", Georgia, serif; font-size: 0.92rem;
    padding: 0.45rem 0.6rem;
  }
  .jform textarea { min-height: 2.6rem; resize: vertical; }
  .jform input:focus, .jform select:focus, .jform textarea:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
  .btn {
    font-family: "Bricolage Grotesque", sans-serif; font-weight: 650; font-size: 0.9rem;
    background: var(--accent); color: var(--bg); border: none; border-radius: 8px;
    padding: 0.5rem 1.1rem; cursor: pointer;
  }
  .btn:hover { background: var(--accent-ink); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .jentry { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 0.7rem 0.95rem; margin: 0.6rem 0; }
  .jentry .top { display: flex; gap: 0.7rem; align-items: baseline; flex-wrap: wrap; }
  .jentry .d { font-family: "IBM Plex Mono", monospace; font-size: 0.75rem; font-weight: 600; }
  .jentry .h { font-family: "IBM Plex Mono", monospace; font-size: 0.7rem; color: var(--muted); }
  .jentry .del { margin-left: auto; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.85rem; }
  .jentry .del:hover { color: var(--warn); }
  .jentry dl { margin: 0.3rem 0 0; }
  .jentry dt { font-family: "IBM Plex Mono", monospace; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-top: 0.3rem; }
  .jentry dd { margin: 0; font-size: 0.92rem; }
  .savebar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    background: var(--surface); border-top: 1px solid var(--line);
    padding: 0.6rem 1rem; display: none; align-items: center; gap: 0.8rem; justify-content: center; flex-wrap: wrap;
  }
  .savebar.show { display: flex; }
  .savebar .msg { font-family: "IBM Plex Mono", monospace; font-size: 0.75rem; color: var(--warn); }
  .banner { background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 0.6rem 0.9rem; font-size: 0.88rem; color: var(--muted); margin: 0.8rem 0; }
  .legend { font-size: 0.85rem; color: var(--muted); }
  .foot { color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--line); margin-top: 2.5rem; padding-top: 1rem; font-family: "IBM Plex Mono", monospace; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div id="app" class="wrap"><noscript>Bu defter JavaScript ister.</noscript></div>
<script type="application/json" id="mufredat">__MUFREDAT_JSON__</script>
<script type="application/json" id="state">__STATE_JSON__</script>
<script id="appjs">
(function () {
  'use strict';
  var LS_KEY = 'llm-atolye-defteri-v1';
  var MUF = JSON.parse(document.getElementById('mufredat').textContent);
  var ITEMS = MUF.items, PHASES = MUF.phases, LEVELS = MUF.levels;
  var ITEM_BY_ID = {};
  ITEMS.forEach(function (i) { ITEM_BY_ID[i.id] = i; });

  function itemMax(it) { return it.max != null ? it.max : (it.t === 'yap' ? 4 : 2); }
  function passLevel(it) { return Math.min(it.t === 'yap' ? 3 : 2, itemMax(it)); }
  function levelNames(it) { return LEVELS[it.t].slice(0, itemMax(it) + 1); }

  function defaultState() { return { v: 1, items: {}, journal: [], updated: null }; }
  function normalizeState(s) {
    if (!s || typeof s !== 'object') return null;
    var out = defaultState();
    out.updated = (typeof s.updated === 'string') ? s.updated : null;
    if (s.items && typeof s.items === 'object') {
      Object.keys(s.items).forEach(function (k) {
        var it = ITEM_BY_ID[k]; if (!it) return;
        var v = parseInt(s.items[k], 10);
        if (isNaN(v) || v <= 0) return;
        out.items[k] = Math.min(v, itemMax(it));
      });
    }
    if (Array.isArray(s.journal)) {
      s.journal.forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return;
        out.journal.push({
          id: String(e.id || 'j' + Math.random().toString(36).slice(2)),
          date: e.date,
          hours: (+e.hours > 0) ? +e.hours : 0,
          phase: typeof e.phase === 'string' ? e.phase : 'z',
          yaptim: String(e.yaptim || ''), ogrendim: String(e.ogrendim || ''),
          anlamadim: String(e.anlamadim || ''), yarin: String(e.yarin || '')
        });
      });
    }
    return out;
  }

  var embedded = null;
  try { embedded = normalizeState(JSON.parse(document.getElementById('state').textContent)); } catch (e) { embedded = null; }
  var state = embedded || defaultState();
  var EMBEDDED_JSON = JSON.stringify(state);
  var localWasNewer = false;
  try {
    var rawLoc = localStorage.getItem(LS_KEY);
    if (rawLoc) {
      var loc = normalizeState(JSON.parse(rawLoc));
      if (loc && loc.updated && (!state.updated || loc.updated > state.updated)) {
        state = loc; localWasNewer = true;
      }
    }
  } catch (e) { /* localStorage yoksa gömülüyle devam */ }

  var storageBroken = false;
  function saveLocal() {
    state.updated = new Date().toISOString();
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); storageBroken = false; }
    catch (e) { storageBroken = true; }
  }
  function isDirty() { return JSON.stringify(state) !== EMBEDDED_JSON; }
  function downloadState() {
    var blob = new Blob([JSON.stringify(state, null, 1) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'durum.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isoWeekKey(dstr) {
    var d = new Date(dstr + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    var day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }
  function lvl(id) { return state.items[id] || 0; }
  function phaseItems(pid) { return ITEMS.filter(function (i) { return i.p === pid; }); }
  function phasePct(pid) {
    var its = phaseItems(pid); if (!its.length) return 0;
    var s = 0; its.forEach(function (i) { s += lvl(i.id) / itemMax(i); });
    return Math.round(100 * s / its.length);
  }
  function gateStatus(pid) {
    var core = phaseItems(pid).filter(function (i) { return i.core; });
    var allPass = core.every(function (i) { return lvl(i.id) >= passLevel(i); });
    var oneMax = core.some(function (i) { return lvl(i.id) >= itemMax(i); });
    if (allPass && oneMax) return 'on';
    return phaseItems(pid).some(function (i) { return lvl(i.id) > 0; }) ? 'run' : 'off';
  }
  function overallPct() {
    var core = ITEMS.filter(function (i) { return i.core; });
    var s = 0; core.forEach(function (i) { s += lvl(i.id) / itemMax(i); });
    return Math.round(100 * s / core.length);
  }
  function hoursThisWeek() {
    var wk = isoWeekKey(todayLocal()), s = 0;
    if (!wk) return 0;
    state.journal.forEach(function (e) { if (isoWeekKey(e.date) === wk) s += (+e.hours || 0); });
    return s;
  }
  function totalHours() {
    var s = 0; state.journal.forEach(function (e) { s += (+e.hours || 0); });
    return s;
  }
  function esc(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var app = document.getElementById('app');
  var openPhases = {};
  PHASES.forEach(function (p) { if (gateStatus(p.id) === 'run') openPhases[p.id] = true; });
  if (!Object.keys(openPhases).length) openPhases.z = true;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function emptyDraft() { return { date: '', hours: '', phase: 'z', j1: '', j2: '', j3: '', j4: '' }; }
  var draft = emptyDraft();

  function render() {
    app.innerHTML = '';
    app.appendChild(el('p', 'kicker', 'llm atölyesi · müstakil seans defteri'));
    app.appendChild(el('h1', null, 'LLM Atölye Defteri'));
    app.appendChild(el('p', 'lede', 'Veri kaynağı depodaki <code>durum.json</code>; bu sayfa ondan üretildi. Değişikliklerin tarayıcıda saklanır — depoya taşımak için alttaki "durum.json indir" düğmesini kullan, dosyayı değiştir, istersen <code>python3 defter.py html</code> ile sayfayı tazele.'));

    if (localWasNewer) app.appendChild(el('div', 'banner', 'Tarayıcıda depodakinden daha yeni kayıt bulundu ve yüklendi. Depoya işlemek için "durum.json indir" → dosyayı değiştir.'));
    if (storageBroken) app.appendChild(el('div', 'banner', 'Uyarı: tarayıcı depolaması çalışmıyor — sekmeyi kapatmadan önce mutlaka "durum.json indir".'));

    var dash = el('div', 'dash');
    var wh = hoursThisWeek();
    dash.appendChild(statBox(overallPct() + '%', 'çekirdek ilerleme', ''));
    dash.appendChild(statBox(wh.toFixed(1).replace('.0', '') + ' sa', 'bu hafta', 'hedef 8–10 sa'));
    dash.appendChild(statBox(totalHours().toFixed(1).replace('.0', '') + ' sa', 'toplam', state.journal.length + ' seans'));
    var last = state.journal.length ? state.journal.map(function (e) { return e.date; }).sort().pop() : null;
    dash.appendChild(statBox(last ? last.slice(5) : '—', 'son seans', last ? '' : 'henüz kayıt yok'));
    app.appendChild(dash);

    var bars = el('div', 'allbars');
    PHASES.forEach(function (p) {
      var b = el('div', 'pb'); b.title = p.name + ' — %' + phasePct(p.id);
      var i = el('i'); i.style.background = p.color; i.style.width = phasePct(p.id) + '%';
      b.appendChild(i); bars.appendChild(b);
    });
    app.appendChild(bars);

    app.appendChild(el('p', 'legend', 'Merdiven — yap-maddeleri: <span class="mono">0 başlamadım · 1 bütünü gördüm · 2 kapalı kitap yazdım · 3 egzersiz/test yeşil · 4 Türkçe büküm + defter</span>; oku-maddeleri: <span class="mono">0 · 1 okudum · 2 deftere özetledim</span>. Kapı kuralı: çekirdek (Ç) maddelerin tümü ≥ 3 (oku: ≥ 2) ve en az biri tavanda. Aynı basamağa ikinci kez tıklamak bir basamak geri alır.'));

    PHASES.forEach(function (p) { app.appendChild(phaseCard(p)); });

    app.appendChild(el('h2', null, 'Seans günlüğü'));
    app.appendChild(journalForm());
    var list = el('div');
    state.journal.slice().sort(function (a, b) {
      if (a.date === b.date) return a.id === b.id ? 0 : (a.id < b.id ? 1 : -1);
      return a.date < b.date ? 1 : -1;
    }).forEach(function (e) { list.appendChild(journalEntry(e)); });
    app.appendChild(list);

    app.appendChild(el('p', 'foot', 'Üretim: __URETIM__ · kaynak: durum.json + mufredat.json · üretici: defter.py'));
    renderSavebar();
  }

  function statBox(v, l, sub) {
    var s = el('div', 'stat');
    s.appendChild(el('div', 'v', esc(v)));
    s.appendChild(el('div', 'l', esc(l)));
    if (sub) s.appendChild(el('div', 'sub', esc(sub)));
    return s;
  }

  function phaseCard(p) {
    var card = el('div', 'pcard' + (openPhases[p.id] ? ' open' : ''));
    card.style.setProperty('--pc', p.color);
    var head = el('div', 'phead');
    head.appendChild(el('span', 'tag' + (p.dark ? ' inkdark' : ''), esc(p.tag)));
    head.appendChild(el('span', 'nm', esc(p.name)));
    var g = gateStatus(p.id);
    head.appendChild(el('span', 'gate' + (g === 'on' ? ' on' : g === 'run' ? ' run' : ''),
      g === 'on' ? 'KAPI GEÇİLDİ' : g === 'run' ? 'sürüyor' : 'başlamadı'));
    head.appendChild(el('span', 'ppct', '%' + phasePct(p.id)));
    head.appendChild(el('span', 'chev', '▶'));
    head.addEventListener('click', function () {
      openPhases[p.id] = !openPhases[p.id]; render();
    });
    card.appendChild(head);

    var body = el('div', 'pbody');
    phaseItems(p.id).forEach(function (it) {
      var row = el('div', 'item');
      var r1 = el('div', 'row');
      r1.appendChild(el('span', 'lbl', esc(it.lbl) + (it.core ? ' <span class="core">Ç</span>' : '')));
      var lv = el('div', 'lvls');
      var names = levelNames(it);
      for (var n = 0; n <= itemMax(it); n++) {
        (function (n) {
          var b = document.createElement('button');
          b.textContent = n;
          b.title = names[n];
          b.setAttribute('aria-label', it.lbl + ': ' + names[n]);
          if (lvl(it.id) >= n && n > 0) b.className = 'hit' + (p.dark ? ' inkdark' : '');
          b.addEventListener('click', function () {
            var cur = lvl(it.id);
            var next = (cur === n) ? Math.max(0, n - 1) : n;
            if (next === cur) return;
            if (next === 0) delete state.items[it.id]; else state.items[it.id] = next;
            saveLocal(); render();
          });
          lv.appendChild(b);
        })(n);
      }
      r1.appendChild(lv);
      row.appendChild(r1);
      if (it.hint) row.appendChild(el('div', 'hint', esc(it.hint)));
      row.appendChild(el('div', 'lvlname', esc(names[lvl(it.id)])));
      body.appendChild(row);
    });
    card.appendChild(body);
    return card;
  }

  function journalForm() {
    var f = el('div', 'jform');
    var g = el('div', 'jgrid');
    g.innerHTML =
      '<div><label for="jd">Tarih</label><input id="jd" type="date"></div>' +
      '<div><label for="jh">Saat</label><input id="jh" type="number" min="0" step="0.5" placeholder="2.5"></div>' +
      '<div><label for="jp">Faz</label><select id="jp">' +
      PHASES.map(function (p) { return '<option value="' + p.id + '">' + esc(p.tag + ' — ' + p.name) + '</option>'; }).join('') +
      '</select></div>';
    f.appendChild(g);
    var g2 = el('div', 'jgrid');
    g2.innerHTML =
      '<div><label for="j1">Ne yaptım</label><textarea id="j1"></textarea></div>' +
      '<div><label for="j2">Ne öğrendim</label><textarea id="j2"></textarea></div>' +
      '<div><label for="j3">Neyi anlamadım</label><textarea id="j3"></textarea></div>' +
      '<div><label for="j4">Yarın ilk iş</label><textarea id="j4"></textarea></div>';
    f.appendChild(g2);

    f.querySelector('#jd').value = draft.date || todayLocal();
    f.querySelector('#jh').value = draft.hours;
    f.querySelector('#jp').value = draft.phase;
    f.querySelector('#j1').value = draft.j1;
    f.querySelector('#j2').value = draft.j2;
    f.querySelector('#j3').value = draft.j3;
    f.querySelector('#j4').value = draft.j4;
    function syncDraft() {
      draft.date = f.querySelector('#jd').value;
      draft.hours = f.querySelector('#jh').value;
      draft.phase = f.querySelector('#jp').value;
      draft.j1 = f.querySelector('#j1').value;
      draft.j2 = f.querySelector('#j2').value;
      draft.j3 = f.querySelector('#j3').value;
      draft.j4 = f.querySelector('#j4').value;
    }
    f.addEventListener('input', syncDraft);
    f.addEventListener('change', syncDraft);

    var btn = el('button', 'btn', 'Seansı kaydet');
    var jmsg = el('span', 'h', '');
    jmsg.style.marginLeft = '0.7rem';
    jmsg.style.fontFamily = '"IBM Plex Mono", monospace';
    jmsg.style.fontSize = '0.72rem';
    btn.addEventListener('click', function () {
      var entry = {
        id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: f.querySelector('#jd').value || todayLocal(),
        hours: parseFloat(f.querySelector('#jh').value) || 0,
        phase: f.querySelector('#jp').value,
        yaptim: f.querySelector('#j1').value.trim(),
        ogrendim: f.querySelector('#j2').value.trim(),
        anlamadim: f.querySelector('#j3').value.trim(),
        yarin: f.querySelector('#j4').value.trim()
      };
      if (!entry.yaptim && !entry.hours) {
        jmsg.textContent = 'En azından "ne yaptım" ya da saat gir.';
        return;
      }
      state.journal.push(entry);
      draft = emptyDraft();
      saveLocal(); render();
    });
    f.appendChild(btn);
    f.appendChild(jmsg);
    return f;
  }

  function journalEntry(e) {
    var d = el('div', 'jentry');
    var ph = PHASES.filter(function (p) { return p.id === e.phase; })[0];
    var top = el('div', 'top');
    top.appendChild(el('span', 'd', esc(e.date)));
    top.appendChild(el('span', 'h', esc((e.hours || 0) + ' sa · ' + (ph ? ph.tag : ''))));
    var del = el('button', 'del', '✕');
    del.title = 'Seansı sil';
    del.addEventListener('click', function () {
      state.journal = state.journal.filter(function (x) { return x.id !== e.id; });
      saveLocal(); render();
    });
    top.appendChild(del);
    d.appendChild(top);
    var dl = el('dl');
    [['Yaptım', e.yaptim], ['Öğrendim', e.ogrendim], ['Anlamadım', e.anlamadim], ['Yarın', e.yarin]].forEach(function (pair) {
      if (pair[1]) { dl.appendChild(el('dt', null, pair[0])); dl.appendChild(el('dd', null, esc(pair[1]))); }
    });
    d.appendChild(dl);
    return d;
  }

  var savebar = el('div', 'savebar');
  document.body.appendChild(savebar);
  function renderSavebar() {
    savebar.innerHTML = '';
    if (!isDirty()) { savebar.className = 'savebar'; return; }
    savebar.className = 'savebar show';
    savebar.appendChild(el('span', 'msg', 'Sayfa üretiminden bu yana değişiklik var — depoya işle:'));
    var b = el('button', 'btn', 'durum.json indir');
    b.addEventListener('click', function () { downloadState(); });
    savebar.appendChild(b);
  }

  render();
})();
</script>
</body>
</html>
'''

if __name__ == "__main__":
    main()
