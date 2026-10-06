// Vite build configuration for box-office. Part of box-office-estate
// (module 07, lab 07-hackathon-two-worlds).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
});
