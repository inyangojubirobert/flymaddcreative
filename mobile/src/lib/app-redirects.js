exports.getLandingRoute = function getLandingRoute(token) {
  return token ? '/(tabs)' : '/(auth)/login';
};
