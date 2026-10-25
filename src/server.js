import app, { sessionStore } from './app.js';
import { connectDB } from './config/db.js';
import { loadTracks } from './utils/curriculumStore.js'

const PORT = process.env.PORT || 3000;

await connectDB();
await sessionStore.collectionP;
await loadTracks();

app.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});