import app from './app.js';
import { PORT } from './config/env.js';

const server = app.listen(PORT, () => {
  console.log(`Dynamic Pricing API running on port ${PORT}`);
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});
