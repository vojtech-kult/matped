import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { buildReport, postMessage } from '../utils/dailyReport.js';
import { todayInPrague, isValidDate } from '../utils/calendar.js';

// Použití:
//   npm run daily-report                      náhled dnešní zprávy (nic se neodešle)
//   npm run daily-report -- --date=2026-10-20 náhled pro jiný den
//   npm run daily-report -- --send            skutečné odeslání na Discord (pingne lektory!)
const args = process.argv.slice(2);
const send = args.includes('--send');
const date = args.find((a) => a.startsWith('--date='))?.slice(7) ?? todayInPrague();

if (!isValidDate(date)) {
  console.error('Neplatné datum, použijte --date=RRRR-MM-DD');
  process.exit(1);
}

await connectDB();
const report = await buildReport(date);

if (!report) {
  console.log(`Na ${date} nejsou žádné lekce s přihlášeným studentem, nic by se neodeslalo.`);
} else {
  for (const message of report.messages) console.log(`-----\n${message}\n`);
  if (send) {
    for (const message of report.messages) await postMessage(message, report.mentionIds);
    console.log('Odesláno na Discord.');
  } else {
    console.log('----- Náhled, nic se neodeslalo. Pro odeslání přidejte --send.');
  }
}
await mongoose.disconnect();