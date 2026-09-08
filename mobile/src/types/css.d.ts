// Ambient declarations for CSS/CSS-module imports (used by the web build
// target via react-native-web + Metro's CSS support). Metro/webpack handle
// these specially at runtime - this file only satisfies `tsc`, which has no
// built-in knowledge of CSS imports.
declare module '*.css';
declare module '*.module.css';
