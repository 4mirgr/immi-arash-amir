import {defineConfig} from 'vite';
export default defineConfig({
 server:{proxy:{'/api':'http://127.0.0.1:8787'}},
 build:{outDir:'dist',rollupOptions:{output:{
  // Cache interface copy independently of application logic and private data.
  manualChunks(id){const path=id.replace(/\\/g,'/');if(path.includes('/src/locales/')||path.endsWith('/src/ui-translations.mjs'))return 'interface-language';},
 }}},
});
