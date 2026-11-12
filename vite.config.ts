import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://squareix.github.io/startfield/ via GitHub Pages.
  base: '/startfield/',
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['absolutely-rebecca-philip-attractive.trycloudflare.com'],
  },
})
