import app, { sessionStore } from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 3000;

await connectDB();
await sessionStore.collectionP; // úložiště sessions musí být připravené před prvním požadavkem

app.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});