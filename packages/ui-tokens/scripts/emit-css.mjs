// Writes dist/theme.css from the compiled tokens so the web app can `@import` it.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toThemeCss } = require('../dist/index.js');

writeFileSync(new URL('../dist/theme.css', import.meta.url), toThemeCss());
