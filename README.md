# Travelator

A tool for creating travel montage videos.

Turn a trip into a vertical travel reel, right in the browser: **https://adarshnair.in/travelator/**

1. Search for each place you visited, or click it on the map.
2. Pick how you got there from the last stop: car, train or flight.
3. Add up to four photos at each stop.
4. Press **Done, make my reel** to watch it, then **Download** to save the video (MP4, or WebM where MP4 isn't supported).

Photos never leave your device; the video is made in your browser.

## How it works

- **Editor:** React, Leaflet with OpenStreetMap tiles, and Nominatim for place search.
- **Reel:** a [Remotion](https://www.remotion.dev) composition at 1080×1920, 30 fps. Roads wind, flights follow an arc and trains run on a track, all drawn on a world map from `world-atlas`.
- **Export:** `@remotion/web-renderer` encodes the video in the browser.

| File | What it holds |
| --- | --- |
| `src/travel/TravelEditorPage.jsx` | Editor page, player and export |
| `src/travel/TravelReel.jsx` | The video composition |
| `src/travel/geo.js` | Map camera, timeline and route curves |
| `src/travel/geocode.js` | Place search and reverse lookup |
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

Map data © OpenStreetMap contributors.
