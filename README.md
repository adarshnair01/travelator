# Travelator

A tool for creating travel montage videos.

Turn a trip into a vertical travel reel, right in the browser: **https://adarshnair.in/travelator/**

**Fastest start:** press **Build from trip photos** and pick your trip's photos. Travelator reads the place and time your phone saved in each photo (on your device), groups them into stops in the order you took them, names each place, and attaches the photos. A single photo taken between two places becomes a photo on the way. Photos without a saved location are skipped, so add those by hand.

Or build the trip by hand:

1. Start typing a place you visited (a city or a landmark): suggestions appear as you type, favouring places near your latest stop. Or click it on the map.
2. Pick how you got there from the last stop: car, bike, bus, train, ferry or flight. A trip can have up to 30 stops.
3. Add up to four photos at each stop. Optionally add up to three photos taken on the way: the vehicle pauses partway along that leg to show them.
4. Press **Done, make my reel** to watch it and pick a map style (Minimal, Black & white, Comic, Manga, Vintage atlas or Midnight), then **Download** to save the video (MP4, or WebM where MP4 isn't supported).

Photos never leave your device; the video is made in your browser.

## How it works

- **Editor:** React, Leaflet with OpenStreetMap tiles, Photon for suggestions while typing, and Nominatim for the full search and for naming clicked places (a click on a landmark is named after the landmark).
- **Routes:** car, bike and bus legs follow real roads from the public OSRM server; train legs follow the same corridor, smoothed into long sweeps. If routing fails, a curve that stays on land is drawn instead, or a path found over the land on the world map, so routes don't cross the sea. Ferry legs do the opposite: a gentle curve that stays on water, or a path found over the sea when the coast is in the way. Flights fly an arc.
- **Reel:** a [Remotion](https://www.remotion.dev) composition at 1080×1920, 30 fps. Roads wind, flights follow an arc, trains run on a track and ferries sail a sea lane, all drawn on a world map from `world-atlas`.
- **Export:** `@remotion/web-renderer` encodes the video in the browser.

| File | What it holds |
| --- | --- |
| `src/travel/TravelEditorPage.jsx` | Editor page, player and export |
| `src/travel/TravelReel.jsx` | The video composition |
| `src/travel/geo.js` | Map camera, timeline and route curves |
| `src/travel/geocode.js` | Place search, suggestions while typing and reverse lookup |
| `src/travel/routes.js` | Routes for every leg but flights: over land, or over water for ferries |
| `src/travel/themes.js` | Map styles: map colours and textures, panel looks |
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

Map data © OpenStreetMap contributors. Country shapes from Natural Earth.
