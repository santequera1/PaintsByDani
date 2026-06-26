import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: './',
  build: {
    minify: 'esbuild',
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        playground: resolve(__dirname, 'playground.html'),
        catalina: resolve(__dirname, 'catalina.html'),
      },
    },
  },
})
