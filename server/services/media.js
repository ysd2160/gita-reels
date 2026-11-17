import express from 'express';
import { config } from '../config.js';

/** Tiny static server so Remotion's headless Chrome can fetch audio/background files (used by the CLI). */
export function startMediaServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use('/media', express.static(config.paths.storage));
    app.use('/assets', express.static(config.paths.assets));
    const server = app.listen(config.port, () => resolve(server));
    server.on('error', (e) => {
      // `npm start` already running on this port -> it serves the same folders, so that's fine
      if (e.code === 'EADDRINUSE') resolve(null);
      else reject(e);
    });
  });
}
