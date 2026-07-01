# ft-visual

Three.js + Rapier3D physics scene with a VHS shader and paint-splash overlay.

**Live demo:** https://urshofer.github.io/ft-visual

## Branches

- `source` — project source (this branch).
- `main` — built GitHub Pages output (served at the live demo URL).

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

`vite build` outputs to `dist/`, then a build plugin copies the runtime-loaded
assets Vite doesn't bundle (the OBJ models in `src/models/` and
`bg/bg.webp`). Asset URLs are relative (`base: './'`) so the site works from the
`/ft-visual/` sub-path on GitHub Pages.

The `dist/` folder is a separate clone of this repo checked out on the `main`
branch; commit and push there to publish a new build.
