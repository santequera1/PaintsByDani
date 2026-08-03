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
        conexiones: resolve(__dirname, 'conexiones.html'),
        museo: resolve(__dirname, 'museo.html'),
        museoRumiaciones: resolve(__dirname, 'museo-rumiaciones.html'),
        museoAlma: resolve(__dirname, 'museo-alma.html'),
        alma: resolve(__dirname, 'alma.html'),
        rumiaciones: resolve(__dirname, 'rumiaciones.html'),
        // Museario (Fase 1): páginas dinámicas alimentadas por la API
        m: resolve(__dirname, 'm.html'),
        g: resolve(__dirname, 'g.html'),
        // Museario (Fase 2): cuenta e inicio de sesión
        cuenta: resolve(__dirname, 'cuenta.html'),
      },
    },
  },
})
