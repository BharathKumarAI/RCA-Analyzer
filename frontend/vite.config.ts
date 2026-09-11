import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'root-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '') {
            res.writeHead(302, { Location: '/admin/' });
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  base: '/admin/',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
      '/ready': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
