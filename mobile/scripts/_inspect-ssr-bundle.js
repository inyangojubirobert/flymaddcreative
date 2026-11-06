const http = require('http');

const url =
  'http://localhost:8081/node_modules/expo/node_modules/@expo/cli/node_modules/@expo/router-server/node/render.js.bundle?platform=web&dev=true&hot=false&transform.engine=hermes&transform.routerRoot=src%2Fapp&resolver.environment=node&transform.environment=node&unstable_transformProfile=hermes-stable';

http
  .get(url, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const d = Buffer.concat(chunks).toString('utf8');
      console.log('production idx', d.indexOf('react.production'));
      console.log('snippet', d.slice(d.indexOf('react.production') - 100, d.indexOf('react.production') + 150));
      const fn = d.indexOf('function registerExportsForReactRefresh');
      console.log(d.slice(fn, fn + 1200));
      const req = d.indexOf('function metroRequire');
      console.log(d.slice(req, req + 1800));
    });
  })
  .on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
