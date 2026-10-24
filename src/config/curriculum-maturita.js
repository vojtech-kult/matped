// Maturitní kurikulum (10 levelů). ID podúkolu se nesmí měnit ani opakovat v rámci tohoto souboru.
// Ve zbytku aplikace dostávají tato ID předponu "m-" (viz tracks.js), takže se nemohou srazit s přijímačkami.
export const MATURITA = [
  {
    level: 1,
    title: 'Číselné obory, množiny a logika',
    sections: [
      { id: 'l1-logika', title: 'Výroková logika a důkazy' },
      { id: 'l1-mnoziny', title: 'Množiny, operace s množinami a intervaly' },
      { id: 'l1-obory', title: 'Číselné obory a zaokrouhlování' },
      { id: 'l1-absolutni', title: 'Absolutní hodnota reálného čísla' },
      { id: 'l1-procenta', title: 'Procenta a základy finanční matematiky' },
    ],
  },
  {
    level: 2,
    title: 'Algebraické výrazy',
    sections: [
      { id: 'l2-mnohocleny', title: 'Mnohočleny a jejich úpravy, vzorce' },
      { id: 'l2-lomene', title: 'Lomené výrazy' },
      { id: 'l2-mocniny', title: 'Mocniny s celým a racionálním mocnitelem' },
      { id: 'l2-odmocniny', title: 'Odmocniny a usměrňování zlomků' },
      { id: 'l2-vyrazy-abs', title: 'Úpravy výrazů s absolutní hodnotou' },
    ],
  },
  {
    level: 3,
    title: 'Rovnice, nerovnice a jejich soustavy',
    sections: [
      { id: 'l3-linearni', title: 'Lineární rovnice a nerovnice' },
      { id: 'l3-kvadraticke', title: 'Kvadratické rovnice a nerovnice' },
      { id: 'l3-souciny-podily', title: 'Rovnice v podílovém a součinovém tvaru' },
      { id: 'l3-iracionalni', title: 'Rovnice s neznámou pod odmocninou' },
      { id: 'l3-absolutni', title: 'Rovnice a nerovnice s absolutní hodnotou' },
      { id: 'l3-soustavy', title: 'Soustavy rovnic a nerovnic' },
    ],
  },
  {
    level: 4,
    title: 'Funkce a jejich vlastnosti',
    sections: [
      { id: 'l4-vlastnosti', title: 'Definiční obor, obor hodnot a vlastnosti funkcí' },
      { id: 'l4-linearni', title: 'Lineární funkce a funkce s absolutní hodnotou' },
      { id: 'l4-kvadraticka', title: 'Kvadratická funkce' },
      { id: 'l4-mocninna', title: 'Mocninné funkce a inverzní funkce' },
      { id: 'l4-lomena', title: 'Lineární lomená funkce' },
    ],
  },
  {
    level: 5,
    title: 'Exponenciální a logaritmické funkce a rovnice',
    sections: [
      { id: 'l5-exp-funkce', title: 'Exponenciální funkce a její graf' },
      { id: 'l5-exp-rovnice', title: 'Exponenciální rovnice' },
      { id: 'l5-log-funkce', title: 'Logaritmická funkce a její graf' },
      { id: 'l5-logaritmy', title: 'Vlastnosti logaritmů a pravidla pro počítání' },
      { id: 'l5-log-rovnice', title: 'Logaritmické rovnice' },
    ],
  },
  {
    level: 6,
    title: 'Goniometrie a trigonometrie',
    sections: [
      { id: 'l6-funkce', title: 'Goniometrické funkce a oblouková míra' },
      { id: 'l6-grafy', title: 'Vlastnosti a grafy goniometrických funkcí' },
      { id: 'l6-vzorce', title: 'Goniometrické vzorce' },
      { id: 'l6-rovnice', title: 'Goniometrické rovnice' },
      { id: 'l6-trigonometrie', title: 'Sinová a kosinová věta, řešení trojúhelníku' },
    ],
  },
  {
    level: 7,
    title: 'Planimetrie',
    sections: [
      { id: 'l7-trojuhelniky', title: 'Trojúhelníky, shodnost a podobnost' },
      { id: 'l7-mnoho-uhly', title: 'Čtyřúhelníky a mnohoúhelníky' },
      { id: 'l7-vety', title: 'Pythagorova a Eukleidovy věty' },
      { id: 'l7-kruh', title: 'Kružnice, kruh a jejich části' },
      { id: 'l7-obsahy', title: 'Obvody a obsahy rovinných útvarů' },
    ],
  },
  {
    level: 8,
    title: 'Stereometrie',
    sections: [
      { id: 'l8-polohove', title: 'Vzájemná poloha přímek a rovin' },
      { id: 'l8-metricke', title: 'Vzdálenosti a odchylky v prostoru' },
      { id: 'l8-hranoly', title: 'Hranoly a jehlany' },
      { id: 'l8-rotacni', title: 'Rotační tělesa (válec, kužel, koule)' },
      { id: 'l8-objemy', title: 'Povrchy a objemy těles' },
    ],
  },
  {
    level: 9,
    title: 'Analytická geometrie',
    sections: [
      { id: 'l9-vektory', title: 'Vektory a operace s nimi' },
      { id: 'l9-primka', title: 'Rovnice přímky v rovině a prostoru' },
      { id: 'l9-vzdalenosti', title: 'Vzájemná poloha, vzdálenosti a odchylky' },
      { id: 'l9-kruznice', title: 'Kružnice a elipsa' },
      { id: 'l9-parabola', title: 'Parabola a hyperbola' },
    ],
  },
  {
    level: 10,
    title: 'Kombinatorika, pravděpodobnost a posloupnosti',
    sections: [
      { id: 'l10-kombinatorika', title: 'Kombinatorická pravidla, variace a permutace' },
      { id: 'l10-kombinace', title: 'Kombinace a binomická věta' },
      { id: 'l10-pravdepodobnost', title: 'Základy pravděpodobnosti a statistiky' },
      { id: 'l10-aritmeticka', title: 'Aritmetická posloupnost' },
      { id: 'l10-geometricka', title: 'Geometrická posloupnost a nekonečná řada' },
    ],
  },
];