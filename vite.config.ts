import { defineConfig } from 'vite';

// Relative asset paths, so the build works from any folder: the root of a
// custom domain or a project path like sflolid.github.io/decryptix/.
export default defineConfig({
  base: './',
});
