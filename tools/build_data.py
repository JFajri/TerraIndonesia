#!/usr/bin/env python3
"""Membangun data offline Terra Indonesia.

Membuat assets/data/provinsi.json (38 provinsi, kode resmi). Kabupaten/kota dan kecamatan dibuat oleh build_wilayah.py.

Sumber (simpan ke folder RAW sebagai prov.json):
  ardian28/GeoJson-Indonesia-38-Provinsi  (Provinsi/38 Provinsi Indonesia - Provinsi.json)   [BIG]

Pakai:  python3 build_data.py <RAW_DIR> <OUT_DIR>   (OUT_DIR = assets/data)
"""
import json, os, sys, collections

RAW, OUT = sys.argv[1], sys.argv[2]
load = lambda n: json.load(open(os.path.join(RAW, n), encoding='utf-8'))
prov = load('prov.json')

# Kode provinsi resmi (file sumber memberi kode ganda untuk provinsi Papua yang baru).
CODE = {'Aceh':'11','Sumatera Utara':'12','Sumatera Barat':'13','Riau':'14','Jambi':'15','Sumatera Selatan':'16',
 'Bengkulu':'17','Lampung':'18','Kepulauan Bangka Belitung':'19','Kepulauan Riau':'21','DKI Jakarta':'31',
 'Jawa Barat':'32','Jawa Tengah':'33','Daerah Istimewa Yogyakarta':'34','Jawa Timur':'35','Banten':'36','Bali':'51',
 'Nusa Tenggara Barat':'52','Nusa Tenggara Timur':'53','Kalimantan Barat':'61','Kalimantan Tengah':'62',
 'Kalimantan Selatan':'63','Kalimantan Timur':'64','Kalimantan Utara':'65','Sulawesi Utara':'71','Sulawesi Tengah':'72',
 'Sulawesi Selatan':'73','Sulawesi Tenggara':'74','Gorontalo':'75','Sulawesi Barat':'76','Maluku':'81','Maluku Utara':'82',
 'Papua':'91','Papua Barat':'92','Papua Selatan':'93','Papua Tengah':'94','Papua Pegunungan':'95','Papua Barat Daya':'96'}
OLD_TO_NEW = {'91':'91', '92':'92'}  # kode lama Papua / Papua Barat

def polys(geom):
    if not geom: return []
    return [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates'] if geom['type'] == 'MultiPolygon' else []

def clean_geom(geom):
    out = []
    for poly in polys(geom):
        rings = []
        for ring in poly:
            pts = []
            for x, y in ((round(p[0], 4), round(p[1], 4)) for p in ring):
                if not pts or pts[-1] != [x, y]: pts.append([x, y])
            if pts and pts[0] != pts[-1]: pts.append(pts[0])
            if len(pts) >= 4: rings.append(pts)
        if rings: out.append(rings)
    if not out: return None
    return {'type': 'Polygon', 'coordinates': out[0]} if len(out) == 1 else {'type': 'MultiPolygon', 'coordinates': out}

def inring(x, y, r):
    inside = False
    j = len(r) - 1
    for i in range(len(r)):
        xi, yi, xj, yj = r[i][0], r[i][1], r[j][0], r[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: inside = not inside
        j = i
    return inside

# --- provinsi ---
P = []
for f in prov['features']:
    name = f['properties']['PROVINSI']; g = clean_geom(f['geometry'])
    P.append({'type':'Feature','properties':{'code':CODE[name],'name':name},'geometry':g})
P.sort(key=lambda f: f['properties']['code'])
pbox = []
for f in P:
    xs = [p[0] for poly in polys(f['geometry']) for p in poly[0]]; ys = [p[1] for poly in polys(f['geometry']) for p in poly[0]]
    pbox.append((min(xs), min(ys), max(xs), max(ys)))

def province_at(x, y):
    for f, b in zip(P, pbox):
        if b[0] <= x <= b[2] and b[1] <= y <= b[3]:
            for poly in polys(f['geometry']):
                if inring(x, y, poly[0]) and not any(inring(x, y, h) for h in poly[1:]): return f['properties']['code']
    return None

def province_of(geom, fallback):
    votes = collections.Counter()
    for poly in polys(geom):
        ring = poly[0]; step = max(1, len(ring) // 40)
        for p in ring[::step]:
            c = province_at(p[0], p[1])
            if c: votes[c] += 1
    if votes: return votes.most_common(1)[0][0], False
    return fallback, True

# --- tulis ---
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'provinsi.json'), 'w', encoding='utf-8').write(json.dumps({'type':'FeatureCollection','features':P}, ensure_ascii=False, separators=(',', ':')))
print('provinsi:', len(P))
