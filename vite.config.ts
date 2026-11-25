import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the same build works on a web server and inside the desktop app.
  base: './',
});
