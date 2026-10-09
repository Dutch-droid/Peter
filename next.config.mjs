import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  webpack(config) {
    config.resolve.alias['@'] = root;
    return config;
  },
};
