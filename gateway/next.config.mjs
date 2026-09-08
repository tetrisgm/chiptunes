import { fileURLToPath } from 'node:url';
export default {
  poweredByHeader: false,
  logging: false,
  turbopack: { root: fileURLToPath(new URL('../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../', import.meta.url)),
  async redirects() { return [{source:'/',destination:'/create#music',permanent:false}]; },
  async rewrites() { return [{source:'/create',destination:'/create/index.html'}]; },
  async headers() { return [{source:'/create/:path*',headers:[{key:'Cache-Control',value:'no-store'}]}]; },
};
