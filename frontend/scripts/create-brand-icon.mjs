import { mkdirSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Leaf } from 'lucide-react';

mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/favicon.svg', import.meta.url), renderToStaticMarkup(createElement(Leaf, { size: 32, stroke: '#24483e', strokeWidth: 1.8 })));
