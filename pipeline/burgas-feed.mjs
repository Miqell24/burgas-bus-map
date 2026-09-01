// Burgas has no downloadable GTFS, so this writes one.
//
// „Бургасбус" EOOD announces open GTFS data on its site — and then asks for a
// signed application form and a privacy declaration before it hands the file
// over (burgasbus.info „ДОСТЪП ДО ДАННИ"). The Bulgarian National Access Point
// registers the dataset „Burgas public transport" and lists ZERO files under
// its gtfs-static subset. Nothing reaches Transitous, the MobilityDatabase or
// gtfs.livetransport.eu, and OSM holds two route relations for the whole city.
//
// What IS public and unauthenticated is the backend of the operator's own
// journey planner at transport.burgasbus.info: a Telelink City tenant whose
// /planner/stops and /planner/routes endpoints carry the entire network —
// every pole with its coordinates, every line with its patterns, each pattern
// with its ordered stop list AND an encoded polyline of the road it takes.
// That is a complete GTFS in a different dress, so this script undresses it:
//
//   planner/stops   → stops.txt
//   planner/routes  → routes.txt + trips.txt + stop_times.txt + shapes.txt
//
// One trip per pattern, because the endpoint publishes patterns, not runs —
// which is why build.mjs reads this feed with allVariants: every pattern here
// is a real branch the operator itself lists, not a short-turn sampled out of
// a timetable. stop_times carries the sequence only; the pipeline never reads
// a clock (it matches geometry), so no departure times are invented.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GD = join(ROOT, 'data/gtfs');

const TENANT = '949021bc-c2c0-43ad-a146-20e19bbc3649';
const API = `https://www.telelink.city/api/v1/${TENANT}/transport/planner`;

const t0 = Date.now();
const log = (m) => console.log(`[feed ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

async function getJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt === 4) throw e;
      log(`${url.split('/').pop()}: ${e.message} — retrying (${attempt}/3)`);
      await new Promise((res) => setTimeout(res, 2000 * attempt));
    }
  }
}

// Google's encoded polyline, precision 5 — the format the planner ships its
// pattern geometry in.
function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    let shift = 0, result = 0, b;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}

// Every pole is named twice, „Изгрев, бл. 3 / Izgrev, bl. 3" — the Cyrillic
// half is the one on the flag. build.mjs repeats this filter for headsigns.
const bgHalf = (n) => {
  const parts = String(n || '').split('/').map((s) => s.trim()).filter(Boolean);
  const cyr = parts.filter((s) => /[А-Яа-яЁё]/.test(s));
  return (cyr.length ? cyr : parts).join(' / ').replace(/\s+/g, ' ').trim();
};

const q = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (header, rows) => header.join(',') + '\n' + rows.map((r) => r.map(q).join(',')).join('\n') + '\n';

mkdirSync(GD, { recursive: true });
log('pobieram planner/stops + planner/routes');
const [stopsRaw, routesRaw] = await Promise.all([getJson(`${API}/stops`), getJson(`${API}/routes`)]);
log(`API: ${stopsRaw.length} przystanków, ${routesRaw.length} linii`);

// ---------- stops ----------
const stopName = new Map();
const stopRows = [];
for (const s of stopsRaw) {
  const name = bgHalf(s.name);
  stopName.set(s.id, name);
  stopRows.push([s.id, s.code || '', name, s.latitude, s.longitude,
    s.wheelchairBoarding === 1 ? '1' : '']);
}
writeFileSync(join(GD, 'stops.txt'),
  csv(['stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon', 'wheelchair_boarding'], stopRows));

// ---------- routes / trips / stop_times / shapes ----------
const routeRows = [], tripRows = [], stRows = [], shapeRows = [];
let patterns = 0, noGeom = 0, orphanStops = 0;
for (const r of routesRaw) {
  routeRows.push([r.id, 'BURGASBUS', r.shortName, r.longName || `Линия ${r.shortName}`,
    r.type, r.color ? String(r.color).toUpperCase() : '']);
  for (const p of r.patterns) {
    const tripId = `R${r.id}P${p.index}`;
    const shapeId = tripId;
    // circular lines come back with direction -1; GTFS only knows 0 and 1
    const dir = p.direction === 1 ? '1' : '0';
    const seq = p.stops || [];
    const last = seq.length ? stopName.get(seq[seq.length - 1]) : '';
    const pts = p.geometry ? decodePolyline(p.geometry) : [];
    if (!pts.length) noGeom++;
    tripRows.push([r.id, 'ALL', tripId, last || '', dir, pts.length ? shapeId : '']);
    seq.forEach((sid, i) => {
      if (!stopName.has(sid)) orphanStops++;
      stRows.push([tripId, sid, i + 1, '', '']);
    });
    pts.forEach(([lat, lon], i) => shapeRows.push([shapeId, lat.toFixed(6), lon.toFixed(6), i + 1]));
    patterns++;
  }
}
writeFileSync(join(GD, 'routes.txt'),
  csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'], routeRows));
writeFileSync(join(GD, 'trips.txt'),
  csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id'], tripRows));
writeFileSync(join(GD, 'stop_times.txt'),
  csv(['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], stRows));
writeFileSync(join(GD, 'shapes.txt'),
  csv(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapeRows));

writeFileSync(join(GD, 'agency.txt'),
  csv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
    [['BURGASBUS', 'Бургасбус ЕООД', 'https://burgasbus.info', 'Europe/Sofia', 'bg']]));
writeFileSync(join(GD, 'calendar.txt'),
  csv(['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
    [['ALL', 1, 1, 1, 1, 1, 1, 1, '20260101', '20271231']]));

const lat = stopsRaw.map((s) => s.latitude), lon = stopsRaw.map((s) => s.longitude);
log(`zapisano data/gtfs: ${routeRows.length} linii, ${patterns} wzorców, ${stopRows.length} przystanków, ${shapeRows.length} punktów kształtów`);
log(`kadr przystanków: ${Math.min(...lat).toFixed(4)}..${Math.max(...lat).toFixed(4)} N, ${Math.min(...lon).toFixed(4)}..${Math.max(...lon).toFixed(4)} E`);
if (noGeom) log(`UWAGA: ${noGeom} wzorców bez geometrii — dla nich zadziała pseudo-dopasowanie po przystankach`);
if (orphanStops) log(`UWAGA: ${orphanStops} odwołań do przystanków spoza planner/stops`);
