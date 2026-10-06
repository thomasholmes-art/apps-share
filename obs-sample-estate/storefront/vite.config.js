// storefront build configuration (obs-sample-estate). The container serves
// the output of `vite build` from server.mjs, so no Vite server runs there.
// The server settings below apply only to `npm run dev` on a lab VM: bind on
// every interface, accept the hosted lab addresses (*.labs.decoded.com) and
// proxy /api to checkout-api as server.mjs does.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const lab = {
  host: '0.0.0.0',
  port: 5173,
  allowedHosts: ['.labs.decoded.com', 'localhost'],
  proxy: { '/api': process.env.CHECKOUT_API_URL ?? 'http://localhost:3000' },
};

export default defineConfig({
  plugins: [react()],
  server: lab,
  preview: lab,
});
