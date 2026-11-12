# Ferrum · Android Multi-Tool by OichiDev

Serverless-style SaaS landing page for Ferrum, a Rust-powered Android multi-tool. Built with React, TypeScript, Vite, Tailwind CSS 4, and Three.js. Its hero carousel shows CC0 models as lightweight point clouds (see [ATTRIBUTION.md](ATTRIBUTION.md)), automatically advancing every 9.5 seconds. Drag or touch the active model to rotate it; it resumes its slow automatic rotation when released.

## Live site

Deployed with GitHub Pages on every push to `main` (see `.github/workflows/deploy.yml`):

https://squareix.github.io/startfield/

## Run locally

```sh
npm install
npm run dev -- --host 0.0.0.0
```

The workspace is a frontend-only simulation. It does not execute Android commands; run history is stored in local storage on the current device. No API server is connected.

## Build

```sh
npm run build
npm run preview
```

Connect the interface to Ferrum's Android runtime when the device integration is ready.
