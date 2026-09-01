# Burgas Public Transport — interactive map

Interactive, poster-grade map of the public transport network of **Burgas**:
26 bus lines in the family's navy and the trolleybus **T1** in its green,
matched onto the OpenStreetMap road graph and drawn one stroke per roadway.

Part of the same family as the other maps in this account — same engine, same
visual system, same city switcher.

## Where the data comes from

**Burgas publishes no GTFS anywhere.** This is not an oversight on our side:

* „Бургасбус" ЕООД announces open GTFS data on its own site and then requires a
  signed application form and a privacy declaration before handing the file
  over (burgasbus.info → *ДОСТЪП ДО ДАННИ*);
* the Bulgarian National Access Point registers the dataset *Burgas public
  transport* (`4f74842b-…`) and lists **zero files** under its `gtfs-static`
  subset;
* Transitous, the Mobility Database and `gtfs.livetransport.eu` have nothing
  for the city;
* trinmo.org holds 304 Burgas stop names whose coordinates are corrupt — the
  latitude sits in the `longitude` column and the longitude is simply gone;
* OpenStreetMap holds **two** route relations for the whole network.

What *is* public and unauthenticated is the backend of the operator's own
journey planner at `transport.burgasbus.info` — a Telelink City tenant whose
`/planner/stops` and `/planner/routes` endpoints carry the entire network:
every pole with its coordinates, every line with its patterns, and an encoded
polyline for each pattern. `pipeline/burgas-feed.mjs` turns that into a proper
GTFS under `data/gtfs/` (routes, trips, stop_times, stops, shapes), which the
rest of the pipeline then treats like any other feed.

Two consequences worth knowing:

* **allVariants.** The endpoint publishes *patterns*, not runs — 50 of them
  across 27 lines, each a branch the operator itself lists. There is no
  timetable to sample, so every pattern is drawn: the whole network exactly
  once, with no busiest-short-turn rule to fall for.
* **Overview polylines.** The geometry is simplified the way a routing API
  returns it. Under a kilometre that costs nothing — the engine bridges the
  hole by routing and the line still lands within two metres of the road. One
  pattern (line 3 towards Banevo) jumps 3.7 km straight across open country;
  there the polyline has stopped describing a road, so that pattern is matched
  on its stop sequence instead — 24 poles over 19 km, one every 800 m.

## Result

| | |
|---|---|
| lines | 27 (26 bus + trolleybus T1) |
| patterns drawn | 50 |
| network drawn | 722 km |
| mean matching error | ~2.0 m |
| stops | 306 |

## Trolleybus T1

Burgas ran trolleybuses from 1988, suspended the network in mid-2022, and put
line **T1** back under the wires on 3 February 2025. It is the only
`route_type=11` line in the feed and gets the family's trolleybus green; every
other line is an ordinary bus in navy.

## Build

```bash
npm run download   # writes data/gtfs from the planner API + cuts OSM tiles
npm run build      # GTFS + OSM -> data/out/*.geojson
npm run lines      # the per-line "Lines" view
npm run serve      # http://localhost:8176
```
