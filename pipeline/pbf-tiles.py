#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cuts the OSM extracts this map needs out of a Geofabrik .pbf — same JSON shape
as Overpass ('elements': ways with tags, node ids and geometry), so build.mjs
cannot tell the difference. Overpass would not serve these at all on the day
they were built (504 from every mirror, even for a single small city box).

Burgas: 2 x 2 road tiles over the 21 x 14 km the network actually covers —
Meden Rudnik and Slaveykov at the ends of the BRT spine, Sarafovo and the
airport north-east, Kraymorie south, and the inland villages Banevo, Vetren,
Rudnik, Gorno and Dolno Ezerovo. No rail file: Burgas has no tram and no
metro, and the single trolleybus line T1 rides the road graph like every
trolleybus in this family.
"""
import json, os, re, sys
import osmium

ROOT = os.path.join(os.path.dirname(__file__), '..')
PBFS = [os.path.join(ROOT, 'data', 'bulgaria-latest.osm.pbf')]

# must match pipeline/download.sh — the stop cloud is 42.4394..42.6294 N,
# 27.3592..27.5262 E; this adds ~2 km of margin so a route never runs off the
# graph at the edge of the frame
S, N, W, E = 42.42, 42.65, 27.33, 27.55

HW = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway|construction|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$')
RAIL = re.compile(r'^(tram|light_rail|construction)$')

road_tiles = {}
for i in range(1, 5):
    f = os.path.join(ROOT, f'data/osm/tiles/t{i}.json')
    if os.path.exists(f):
        continue
    row, col = (i - 1) // 2, (i - 1) % 2
    road_tiles[i] = (S + (N - S) * row / 2, S + (N - S) * (row + 1) / 2,
                     W + (E - W) * col / 2, W + (E - W) * (col + 1) / 2)
need_rail = False
print('brakujące kafle dróg:', sorted(road_tiles), flush=True)
if not road_tiles:
    sys.exit(0)
os.makedirs(os.path.join(ROOT, 'data/osm/tiles'), exist_ok=True)

out = {i: [] for i in road_tiles}
out_rail = []


class H(osmium.SimpleHandler):
    def way(self, w):
        tags = w.tags
        hw = tags.get('highway')
        rw = tags.get('railway')
        is_road = bool(road_tiles) and hw is not None and HW.match(hw)
        is_rail = False
        if not is_road and not is_rail:
            return
        geom, ids = [], []
        la0, la1, lo0, lo1 = 90.0, -90.0, 180.0, -180.0
        for n in w.nodes:
            try:
                lo, la = n.lon, n.lat
            except osmium.InvalidLocationError:
                continue
            # node ids ride along: buildGraph() builds topology from el.nodes
            # and SILENTLY skips ways without them (the London t13 hole)
            ids.append(n.ref)
            geom.append({'lat': la, 'lon': lo})
            if la < la0: la0 = la
            if la > la1: la1 = la
            if lo < lo0: lo0 = lo
            if lo > lo1: lo1 = lo
        if len(geom) < 2:
            return
        el = None

        def make():
            nonlocal el
            if el is None:
                el = {'type': 'way', 'id': w.id, 'nodes': ids,
                      'tags': {t.k: t.v for t in tags}, 'geometry': geom}
            return el

        if is_road:
            for i, (s, n_, w_, e) in road_tiles.items():
                if la1 >= s and la0 <= n_ and lo1 >= w_ and lo0 <= e:
                    out[i].append(make())



for pbf in PBFS:
    if not os.path.exists(pbf):
        sys.exit(f'brak {pbf} — pobierz go (pipeline/download.sh)')
    print('czytam', os.path.basename(pbf), flush=True)
    H().apply_file(pbf, locations=True, idx='flex_mem')

GEN = 'pbf-tiles.py (Geofabrik bulgaria)'
for i, els in out.items():
    f = os.path.join(ROOT, f'data/osm/tiles/t{i}.json')
    if os.path.exists(f):
        print(f't{i}: już jest (Overpass zdążył)', flush=True); continue
    json.dump({'version': 0.6, 'generator': GEN, 'elements': els}, open(f, 'w'))
    print(f't{i}: {len(els)} dróg', flush=True)
print('gotowe', flush=True)
