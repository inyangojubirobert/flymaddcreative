const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The API and app share the search compatibility vocabulary in root lib/.
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../lib')];

// npm on Windows creates short-lived .safe-push-apply-* folders under
// node_modules. If Metro walks into one that then disappears, the watcher
// throws ENOENT and kills the bundler.
const safePushBlock = /node_modules[\/\\]\.safe-push-apply-[^\/\\]+[\/\\].*/;
const existing = config.resolver.blockList;
config.resolver.blockList = existing
  ? [existing, safePushBlock].flat()
  : safePushBlock;

// react-native-iap loads a native bridge on import, which crashes web pages.
// The web app never uses Google Play billing, so it gets a stub instead.
const iapWebStub = path.resolve(__dirname, 'src/lib/iap-web-stub.ts');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-iap') return { type: 'sourceFile', filePath: iapWebStub };
  return (upstreamResolve || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
