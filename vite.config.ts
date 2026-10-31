import { defineConfig } from 'vitest/config';

// GitHub Pages（/houchi-kokka/）でもローカルでも動くよう相対パスで出力する
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
