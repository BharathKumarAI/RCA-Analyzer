import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const apiTarget = process.env.RCA_API_TARGET || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'workspace-routes',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const requestUrl = req.url || '';
          const [pathname, search = ''] = requestUrl.split('?');
          // The production app is mounted at /admin/, while project workspaces
          // intentionally live at /p/<project_key>/. Let Vite serve the same
          // SPA entry for a direct project URL so browser refreshes work in dev.
          if (pathname === '/' || pathname === '' || pathname === '/workspace' || pathname === '/workspace/' || pathname === '/admins' || pathname.startsWith('/admins/') || pathname === '/p' || pathname.startsWith('/p/')) {
            req.url = `/admin/${search ? `?${search}` : ''}`;
          }
          next();
        });
      },
    },
  ],
  base: '/admin/',
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ready': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/health': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
