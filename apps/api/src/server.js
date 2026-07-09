import app from './app.js';
import { PORT } from './config/env.js';

app.listen(PORT, () => {
  console.log(`Dynamic Pricing API running on port ${PORT}`);
});
