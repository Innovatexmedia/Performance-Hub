import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    host: true,
    port: 5173,

    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok-free.app',
      '.ngrok.io',
    ],

    proxy: {
      '/api': {
        target: 'https://performance-hub-6dn7.onrender.com/',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});