import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const SERVER = process.env.SERVER_URL || 'http://localhost:3002';

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    fs: { allow: [path.resolve(here, '..')] },
    proxy: { '/socket.io': { target: SERVER, ws: true }, '/api': { target: SERVER } },
  },
  build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2500 },
});
