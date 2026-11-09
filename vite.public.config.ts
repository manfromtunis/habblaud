import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from './vite.config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Public Office (office.bakchich.cc): own entry, so no private UI code is in the bundle.
export default mergeConfig(base, defineConfig({
  build: {
    outDir: r('./dist/public'),
    rollupOptions: { input: { main: r('./client/public.html') } },
  },
}));
