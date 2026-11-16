import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.RELAY_API ?? 'http://localhost:4000';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': api, '/ws': { target: api.replace(/^http/, 'ws'), ws: true } },
  },
});
