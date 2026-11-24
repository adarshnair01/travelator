# Travelator

A tool for creating travel montage videos.

Turn a trip into a vertical travel reel, right in the browser: **https://adarshnair.in/travelator/**

**Fastest start:** press **Build from trip photos** and pick your trip's photos. Travelator reads the place and time your phone saved in each photo (on your device), groups them into stops in the order you took them, names each place, and attaches the photos. A single photo taken between two places becomes a photo on the way. Photos without a saved location are skipped, so add those by hand.

Or build the trip by hand:

1. Search for each place you visited (a city or a landmark), click it on the map, or tap one of the famous spots suggested near your latest stop.
2. Pick how you got there from the last stop: car, bike, train or flight.
3. Add up to four photos at each stop. Optionally add up to three photos taken on the way: the vehicle pauses partway along that leg to show them.
4. Press **Done, make my reel** to watch it and pick a map style (Minimal, Satellite, Black & white, Comic, Manga, Vintage atlas or Midnight), then **Download** to save the video (MP4, or WebM where MP4 isn't supported).

Photos never leave your device; the video is made in your browser.

## How it works

- **Editor:** React, Leaflet with OpenStreetMap tiles, Nominatim for place search and names (a click on a landmark is named after the landmark), and the Overpass API for famous spots near a stop.
- **Routes:** car and bike legs follow real roads from the public OSRM server; train legs follow the same corridor, smoothed into long sweeps. If routing fails, a curve that stays on land is drawn instead, or a path found over the land on the world map, so routes don't cross the sea. Flights fly an arc.
- **Reel:** a [Remotion](https://www.remotion.dev) composition at 1080×1920, 30 fps. Roads wind, flights follow an arc and trains run on a track, all drawn on a world map from `world-atlas`.
- **Export:** `@remotion/web-renderer` encodes the video in the browser.

| File | What it holds |
| --- | --- |
| `src/travel/TravelEditorPage.jsx` | Editor page, player and export |
| `src/travel/TravelReel.jsx` | The video composition |
| `src/travel/geo.js` | Map camera, timeline and route curves |
| `src/travel/geocode.js` | Place search, reverse lookup and famous spots nearby |
| `src/travel/routes.js` | Land-following routes for car and train legs |
| `src/travel/themes.js` | Map styles: map colours and textures, panel looks, satellite tiles |
| `src/travel/photoTrip.js` | Reading photo location and time, and grouping photos into stops |
| `src/travel/world.js` | Loads the world map |

## Develop

```sh
npm install
npm run dev     # http://localhost:5173
npm run lint
npm run build
```

The app is built for the `/travelator/` folder (`base` in `vite.config.js`). It goes live through the travel blog: the blog's deploy workflow in [adarshnair01/travel](https://github.com/adarshnair01/travel) checks out this repo, builds it and publishes it at adarshnair.in/travelator/. The blog rebuilds every day at 00:15 UTC, so a push here is live by the next day; run the blog's "Deploy site" workflow to publish sooner.

Pushes and pull requests here run lint and build (`.github/workflows/check.yml`).

Map data © OpenStreetMap contributors. Country shapes from Natural Earth. Satellite imagery: Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0.
