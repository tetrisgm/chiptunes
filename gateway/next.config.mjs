import { fileURLToPath } from 'node:url';
export default {
  poweredByHeader: false,
  logging: false,
  turbopack: { root: fileURLToPath(new URL('../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../', import.meta.url)),
};
