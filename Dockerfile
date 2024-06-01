FROM node:lts

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

RUN npm run build

RUN apt-get update
RUN apt-get install -y fontconfig cabextract
RUN rm -rf /var/lib/apt/lists/*
RUN wget -q https://downloads.sourceforge.net/corefonts/impact32.exe
RUN cabextract -q -d /usr/share/fonts/truetype/msttcorefonts impact32.exe
RUN fc-cache -f -v
RUN rm impact32.exe

EXPOSE 3000

CMD ["npm", "run", "start"]
