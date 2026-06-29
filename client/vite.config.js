import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api calls to the Express backend so the browser hits one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5055',
    },
  },
});
