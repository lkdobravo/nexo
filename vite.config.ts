import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Caminhos relativos — necessário para o app Electron (protocolo nexo://)
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
})
