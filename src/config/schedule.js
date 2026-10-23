export const LECTURERS = ['Adam', 'Vojta', 'Ema'];

export const FIRST_HOUR = 8;  // první lekce 8:00–8:50
export const LAST_HOUR = 20;  // poslední lekce 20:00–20:50, rozvrh končí v 21:00
export const WEEK_MIN = 1;

// Počet ISO týdnů v roce (52 nebo 53). 28. prosince je vždy v posledním týdnu.
export function isoWeeksInYear(year) {
  const d = new Date(Date.UTC(year, 11, 28));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// Kolik studentů se vejde na jednu lekci
export const CAPACITY = 3;

// Barvy lektorů (musí odpovídat jménům v LECTURERS)
export const LECTURER_COLORS = {
  Adam: '#6c97f3', // modrá
  Vojta: '#a276ee', // fialová
  Ema: '#f362a3', // růžová
};

// Rezervovat jde od zítřka (1 = zítra) a tolik dní dopředu
export const BOOKING_START_OFFSET_DAYS = 1;
export const BOOKING_WEEKS = 3;


// Discord ID lektorů pro ping v denním přehledu. Bez ID se lektor jen jmenuje, neping­ne se.
/*
export const LECTURER_DISCORD_IDS = {
  Adam: '416277258739908649',
  Vojta: '660180333865598986',
  Ema: '1445863738182733865',
};*/

export const LECTURER_DISCORD_IDS = {
  Adam: '',
  Vojta: '',
  Ema: '',
};