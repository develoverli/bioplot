import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The app is a static site; it can be served from any path.
  base: './',
  build: {
    target: 'es2022',
  },
})
