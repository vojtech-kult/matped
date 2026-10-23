# Použijeme oficiální Node.js (verze 20) na Debianu
FROM node:20-bullseye

# Nainstalujeme LaTeX (základní balíčky + extra fonty a doplňky)
RUN apt-get update && apt-get install -y \
    texlive-latex-base \
    texlive-fonts-recommended \
    texlive-latex-extra \
    && rm -rf /var/lib/apt/lists/*

# Nastavíme pracovní složku
WORKDIR /app

# Zkopírujeme package.json a nainstalujeme Node moduly
COPY package*.json ./
RUN npm install

# Zkopírujeme zbytek vašeho kódu
COPY . .

# Spustíme váš server (upravte cestu, pokud máte server.js v podsložce)
CMD ["node", "server.js"]