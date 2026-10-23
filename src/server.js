import app from './app.js';
import { connectDB } from './config/db.js';
import { startDailyReportScheduler } from './utils/dailyReport.js';

const PORT = process.env.PORT || 3000;

await connectDB();

app.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});

startDailyReportScheduler();