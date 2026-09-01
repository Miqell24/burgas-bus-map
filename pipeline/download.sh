#!/usr/bin/env bash
# Downloads input data: the Burgas GTFS this project writes itself, the OSM
# extract, MapLibre GL. Everything is cached — re-running only fetches what is
# missing.
#
# There is NO Burgas GTFS to download. Burgasbus announces open data and then
# asks for a signed application form; the Bulgarian NAP registers the dataset
# "Burgas public transport" with zero files under its gtfs-static subset; and
# nothing reaches Transitous, the MobilityDatabase or gtfs.livetransport.eu.
# pipeline/burgas-feed.mjs writes the feed instead, out of the public backend
# of the operator's own journey planner (transport.burgasbus.info).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/osm/tiles web/vendor

# pyosmium does the cutting; it is the one dependency outside Node here.
need_osmium () {
  python3 -c "import osmium" 2>/dev/null && return 0
  echo "brak pakietu osmium — zainstaluj: pip3 install --user osmium" >&2
  return 1
}

# 1) GTFS — written from the planner API, not downloaded
if [ ! -f data/gtfs/routes.txt ]; then
  echo "== Burgasbus planner API -> data/gtfs =="
  node pipeline/burgas-feed.mjs
fi

# 2) OSM — from the Geofabrik extract, not Overpass.
#    2 x 2 road tiles over the 21 x 14 km the network covers, cut out of the
#    Bulgarian Geofabrik extract. No rail file: no tram, no metro, and T1 rides
#    the road graph like every trolleybus in this family.
#    pipeline/pbf-tiles.py cuts the tiles out of the .pbf and writes exactly the
#    JSON shape Overpass would have returned (ways with tags, NODE IDS and
#    geometry — buildGraph silently drops ways without el.nodes).
if [ ! -f data/osm/tiles/t4.json ]; then
  need_osmium
  if [ ! -f data/bulgaria-latest.osm.pbf ]; then
    echo "== Geofabrik bulgaria-latest.osm.pbf =="
    curl -fL --retry 5 --retry-delay 5 -C - --max-time 3600 -o data/bulgaria-latest.osm.pbf \
      "https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf"
  fi
  echo "== cutting OSM tiles out of the extract =="
  python3 pipeline/pbf-tiles.py
fi

# 3) MapLibre GL (vendored, no CDN at runtime)
if [ ! -f web/vendor/maplibre-gl.js ]; then
  echo "== MapLibre GL =="
  curl -fL --retry 3 -o web/vendor/maplibre-gl.js  https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js
  curl -fL --retry 3 -o web/vendor/maplibre-gl.css https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css
fi

echo "OK — data ready:"
du -sh data/gtfs data/osm 2>/dev/null || true
