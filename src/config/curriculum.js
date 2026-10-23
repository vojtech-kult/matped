// Osnova kurzu.
// ID podúkolu se nesmí měnit ani opakovat, podle něj se ukládá splnění.
// Názvy a pořadí upravovat lze. Nový podúkol = nové unikátní ID.
export const XP_PER_SECTION = 10;
export const XP_PER_TEST = 50;

export const CURRICULUM = [
  {
    level: 1,
    title: 'Přirozená čísla a dělitelnost',
    sections: [
      { id: 'l1-zaokrouhlovani', title: 'Zápis, porovnávání a zaokrouhlování čísel' },
      { id: 'l1-operace', title: 'Početní operace a pořadí operací' },
      { id: 'l1-delitelnost', title: 'Dělitelnost a znaky dělitelnosti' },
      { id: 'l1-prvocisla', title: 'Prvočísla a rozklad na součin prvočísel' },
      { id: 'l1-nsd-nsn', title: 'Největší společný dělitel a nejmenší společný násobek' },
    ],
  },
  {
    level: 2,
    title: 'Zlomky a desetinná čísla',
    sections: [
      { id: 'l2-kraceni', title: 'Zlomky, krácení a rozšiřování' },
      { id: 'l2-scitani', title: 'Sčítání a odčítání zlomků' },
      { id: 'l2-nasobeni', title: 'Násobení a dělení zlomků' },
      { id: 'l2-smisena', title: 'Smíšená čísla a složené zlomky' },
      { id: 'l2-desetinna', title: 'Desetinná čísla a převody na zlomky' },
    ],
  },
  {
    level: 3,
    title: 'Celá a racionální čísla',
    sections: [
      { id: 'l3-cela', title: 'Celá čísla a číselná osa' },
      { id: 'l3-scitani', title: 'Sčítání a odčítání záporných čísel' },
      { id: 'l3-nasobeni', title: 'Násobení a dělení záporných čísel' },
      { id: 'l3-racionalni', title: 'Racionální čísla a absolutní hodnota' },
      { id: 'l3-priklady', title: 'Složitější příklady se závorkami' },
    ],
  },
  {
    level: 4,
    title: 'Poměr, úměrnost a procenta',
    sections: [
      { id: 'l4-pomer', title: 'Poměr a postupný poměr' },
      { id: 'l4-prima', title: 'Přímá úměrnost a trojčlenka' },
      { id: 'l4-neprima', title: 'Nepřímá úměrnost' },
      { id: 'l4-procenta', title: 'Procenta, základ a procentová část' },
      { id: 'l4-urok', title: 'Slovní úlohy s procenty a úroky' },
    ],
  },
  {
    level: 5,
    title: 'Mocniny a úpravy výrazů',
    sections: [
      { id: 'l5-mocniny', title: 'Mocniny s přirozeným exponentem a pravidla' },
      { id: 'l5-odmocniny', title: 'Druhá mocnina a odmocnina' },
      { id: 'l5-mnohocleny', title: 'Sčítání, odčítání a násobení mnohočlenů' },
      { id: 'l5-vzorce', title: 'Vzorce (a ± b)² a a² − b²' },
      { id: 'l5-rozklad', title: 'Rozklad na součin (vytýkání)' },
      { id: 'l5-lomene', title: 'Lomené výrazy' },
    ],
  },
  {
    level: 6,
    title: 'Lineární rovnice',
    sections: [
      { id: 'l6-zaklad', title: 'Jednoduché rovnice a zkouška' },
      { id: 'l6-zavorky', title: 'Rovnice se závorkami' },
      { id: 'l6-zlomky', title: 'Rovnice se zlomkem' },
      { id: 'l6-upravy', title: 'Rovnice s úpravou výrazů' },
      { id: 'l6-vzorce', title: 'Vyjádření neznámé ze vzorce' },
      { id: 'l6-slovni', title: 'Slovní úlohy řešené rovnicí' },
    ],
  },
  {
    level: 7,
    title: 'Úhly, trojúhelníky a čtyřúhelníky',
    sections: [
      { id: 'l7-uhly', title: 'Úhly, vrcholové a vedlejší úhly' },
      { id: 'l7-trojuhelniky', title: 'Trojúhelníky: vlastnosti, obvod a obsah' },
      { id: 'l7-konstrukce', title: 'Konstrukce trojúhelníků' },
      { id: 'l7-ctyruhelniky', title: 'Čtyřúhelníky: vlastnosti, obvod a obsah' },
      { id: 'l7-shodnost', title: 'Shodnost a podobnost' },
    ],
  },
  {
    level: 8,
    title: 'Kružnice, kruh a Pythagorova věta',
    sections: [
      { id: 'l8-kruh', title: 'Kružnice a kruh: obvod a obsah' },
      { id: 'l8-thales', title: 'Thaletova kružnice a tečna' },
      { id: 'l8-pyth', title: 'Pythagorova věta' },
      { id: 'l8-pyth-ulohy', title: 'Pythagorova věta v úlohách' },
      { id: 'l8-konstrukce', title: 'Konstrukční úlohy s kružnicí' },
    ],
  },
  {
    level: 9,
    title: 'Tělesa: povrchy a objemy',
    sections: [
      { id: 'l9-hranoly', title: 'Krychle, kvádr a hranol' },
      { id: 'l9-valec', title: 'Válec' },
      { id: 'l9-jehlan-kuzel', title: 'Jehlan a kužel' },
      { id: 'l9-koule', title: 'Koule' },
      { id: 'l9-jednotky', title: 'Převody jednotek obsahu a objemu' },
      { id: 'l9-slovni', title: 'Slovní úlohy o tělesech' },
    ],
  },
  {
    level: 10,
    title: 'Funkce, soustavy rovnic a statistika',
    sections: [
      { id: 'l10-funkce', title: 'Funkce a jejich grafy' },
      { id: 'l10-linearni', title: 'Lineární funkce' },
      { id: 'l10-soustavy', title: 'Soustavy dvou rovnic' },
      { id: 'l10-nerovnice', title: 'Lineární nerovnice' },
      { id: 'l10-statistika', title: 'Statistika: průměr, medián, modus' },
      { id: 'l10-grafy', title: 'Čtení z grafů a diagramů' },
    ],
  },
];

// Duplicitní ID by tiše rozbilo ukládání, proto to hlídáme při startu
const ids = CURRICULUM.flatMap((l) => l.sections.map((s) => s.id));
if (new Set(ids).size !== ids.length) throw new Error('curriculum.js: duplicitní ID podúkolu');