import { readFileSync } from 'node:fs';

// Embed assets for PDF renderers that use page.setContent without an origin.
const font = readFileSync(new URL('../public/fonts/plus-jakarta-sans.ttf', import.meta.url)).toString('base64');
export const reportThemeCss = `@font-face{font-family:"Plus Jakarta Sans";font-style:normal;font-weight:200 800;src:url(data:font/ttf;base64,${font}) format('truetype')}\n${readFileSync(new URL('../public/report-theme.css', import.meta.url), 'utf8')}`;
