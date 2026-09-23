# 🌤️📅📝 Panel na starego iPada

**🇵🇱 Polski** · [🇬🇧 English](README.en.md)

_By **Emilia Miller** (`bugITwhisperer`)_

> **Jeden plik HTML, zero zależności, iPad z 2012 roku z iOS 10.**
> Nie zadziała na nim żadna nowa app pogodowa stąd strona napisana pod jego ograniczenia.

**Na żywo:** <https://bugitwhisperer.github.io/ipad-ios10-home-panel/>

---

## 📑 Spis treści

- [Po co to](#-po-co-to)
- [Trzy widoki](#-trzy-widoki)
- [Co pokazuje pogoda](#-co-pokazuje-pogoda)
- [Tryb nocny](#-tryb-nocny)
- [Jak to działa](#-jak-to-działa)
- [Ograniczenia iOS 10](#-ograniczenia-ios-10)
- [Cykle odświeżania](#-cykle-odświeżania)
- [Zmiana miasta](#-zmiana-miasta)
- [Ustawienia iPada](#-ustawienia-ipada)
- [Plany](#️-plany)

---

## 🤔 Po co to

iPad 4. generacji (**A1458**, 2012) ma **iOS 10** - koniec wsparcia Apple.
App Store nie pozwoli zainstalować app IKEA Home smart ani innej "pogodówki".
Zamiast tego jedna statyczna strona w starej składni, którą Safari jeszcze rozumie

| Warstwa      | Wybór                                | Dlaczego                             |
| ------------ | ------------------------------------ | ------------------------------------ |
| **Dane**     | [Open-Meteo](https://open-meteo.com) | darmowe API                          |
| **Hosting**  | GitHub Pages                         | statyczny HTML                       |
| **Kod**      | jeden plik `index.html`              | HTML + CSS + JS razem                |
| **Składnia** | ES5, stary CSS                       | wszystko nowsze wywala się na iOS 10 |

---

## 🔀 Trzy widoki

Panel przełącza się sam między trzema widokami. Pogoda dostaje połowę czasu pętli.

| Widok         | Czas na ekranie | Stan                 |
| ------------- | --------------- | -------------------- |
| **Pogoda**    | 10 min          | ✅ działa             |
| **Kalendarz** | 5 min           | 🚧 zaślepka (etap B) |
| **Zakupy**    | 5 min           | 🚧 zaślepka (etap C) |

- pełna pętla trwa **20 minut**
- zakładki u góry pozwalają przełączyć widok ręcznie
- dotknięcie ekranu **wstrzymuje rotację na 5 min**, licznik liczony od ostatniego dotknięcia

---

## 👀 Co pokazuje pogoda

**Pogoda bieżąca** u góry: temperatura, ikona, wiatr, opady

Pod spodem **dwa paski godzinowe naraz**:

| Pasek     | Zakres                                      | Sterowanie      |
| --------- | ------------------------------------------- | --------------- |
| **Górny** | dzisiaj, od bieżącej godziny do 23:00       | zawsze widoczny |
| **Dolny** | jutro godzinowo (od wschodu) albo 3/5/7 dni | dropdown        |

Każdy kafelek: **temperatura · ikona · szansa opadów · wiatr**

- godziny, które minęły → **znikają**, nie są wyszarzane
- wschód i zachód **nie ograniczają** już paska - służą tylko trybowi nocnemu
- prognoza dzienna startuje od jutra, żeby nie dublować dzisiaj
- brak sieci lub błąd API → komunikat na ekranie, ponowna próba po minucie
- brakująca wartość z API → `--`, nigdy `NaN`

---

## 🌙 Tryb nocny

| Kiedy                    | Co się dzieje                                   |
| ------------------------ | ----------------------------------------------- |
| **00:30**                | ekran ciemnieje, rotacja staje                  |
| **5 min przed wschodem** | rozjaśnia się sam, rotacja rusza                |
| **dotknięcie w nocy**    | pełny interfejs na 30 s, można przełączać widok |
| **kolejne dotknięcie**   | licznik od nowa, pełne 30 s                     |

Godzina wschodu przychodzi z API, ale jest przypinana do **bieżącego dnia kalendarzowego** - inaczej `sunrise` z innej daty gasił ekran już wieczorem.

---

## 🎯 Jak to działa

```mermaid
graph TD
    subgraph REPO["🗂️ bugITwhisperer/ipad-ios10-home-panel"]
        HTML["index.html<br/>HTML + CSS + JS w jednym pliku"]
    end

    subgraph PAGES["☁️ GitHub Pages"]
        SITE["bugitwhisperer.github.io<br/>/ipad-ios10-home-panel/"]
    end

    subgraph IPAD["📱 iPad 4 (iOS 10) na ścianie"]
        ICON["Ikona na ekranie początkowym<br/>pełny ekran<br/>bez paska adresu"]
        ROT["Rotacja widoków<br/>pogoda 10 min<br/>kalendarz 5 min<br/>lista zakupów/todo 5 min"]
        GUIDED["Dostęp nadzorowany<br/>Home zablokowany<br/>wyjście na kod"]
        ICON --> ROT --> GUIDED
    end

    API["🌐 Open-Meteo API<br/>bez klucza"]

    HTML == "commit → build (~60 s)" ==> SITE
    SITE == "pierwsze wczytanie" ==> ICON
    API -. "co 15 min: dane pogodowe" .-> ICON
    SITE -. "o 4:00: pełne przeładowanie kodu" .-> ICON

    classDef repo fill:#1e3a5f,stroke:#4a90d9,color:#fff
    classDef dev fill:#2d4a2d,stroke:#5aaa5a,color:#fff
    class HTML,SITE repo
    class ICON,ROT,GUIDED dev
```

---

## 🚫 Ograniczenia iOS 10

Kod celowo trzyma się ES5 i starego CSS-a
Testy pilnują, żeby nic nowszego się nie wślizgnęło - statyczny skan odrzuca zakazane konstrukcje:

| ❌ Nie wolno                           | ✅ Zamiast tego                            |
| ------------------------------------- | ----------------------------------------- |
| `let`, `const`, `=>`, backticki       | `var`, `function`                         |
| `fetch`, `Promise`, `async` / `await` | `XMLHttpRequest`                          |
| `.includes()`, spread `...`, `class`  | `.indexOf()`, pętla `for`                 |
| CSS custom properties (`--zmienna`)   | Wartości wpisane wprost                   |
| `gap`, CSS grid, `clamp()`, `:is()`   | Marginesy, flexbox z prefiksem `-webkit-` |

Przy wielodniowej pracy liczy się też to, czego **nie ma**: każdy timer trzymany jest w jednej zmiennej i czyszczony przed ustawieniem nowego, a widoki są chowane klasą zamiast usuwane z DOM.

---

## 🔄 Cykle odświeżania

| Co                    | Kiedy                  | Mechanizm                             |
| --------------------- | ---------------------- | ------------------------------------- |
| **Rotacja widoków**   | pętla 20 min           | `setTimeout`, jeden na raz            |
| **Dane pogodowe**     | co 15 min              | `setInterval(load, 900000)`           |
| **Stan ekranu**       | co minutę              | sprawdzenie, czy zapada noc lub świt  |
| **Kod strony**        | codziennie o 4:00 rano | `location.replace` + `?v=<timestamp>` |
| **Publikacja z repo** | po każdym commicie     | GitHub Pages, ~60 s                   |
| **Ponowna próba**     | po minucie             | Tylko po błędzie sieci lub API        |

---

## 📍 Zmiana miasta

Ustawione miasto: Lublin.
Zmiana miasta wymaga aktualizacji współrzędnych w skrypcie:

```js
var LAT = 51.2465;
var LON = 22.5684;
```

- współrzędne z Google Maps: prawy przycisk na punkcie, pierwsza pozycja w menu
- strefa czasowa i godziny wschodu/zachodu przyjdą z API automatycznie

---

## 📱 Ustawienia iPada

1. **Autoblokada wyłączona** `Ustawienia → Ekran i jasność → Autoblokada → Nigdy`
2. **Ikona na ekranie początkowym** Wejść na stronę <https://bugitwhisperer.github.io/ipad-ios10-home-panel/> w Safari → `Udostępnij` → `Dodaj do ekranu początkowego` → uruchom z ikony (pasek adresu znika)
3. **Blokada orientacji poziomej** Centrum sterowania albo przełącznik boczny (`Ustawienia → Ogólne → Użyj przełącznika bocznego do:`)
4. **Dostęp nadzorowany** _(opcjonalnie)_ `Ustawienia → Ogólne → Dostępność → Dostęp nadzorowany` — blokuje przycisk Home, żeby przypadkowe dotknięcie nie wyrzuciło z aplikacji
   Wyjście z trybu dostępu nadzorowanego: potrójne kliknięcie Home → `Rozpocznij`.

---

## 🗺️ Plany

| Etap  | Funkcja                      | Stan           | Uwagi                                                              |
| ----- | ---------------------------- | -------------- | ------------------------------------------------------------------ |
| **1** | Pogoda + prognoza            | ✅ Gotowe       | —                                                                  |
| **A** | Rotacja widoków + tryb nocny | ✅ Gotowe       | kalendarz i zakupy jako zaślepki                                   |
| **B** | Kalendarz                    | 📋 Planowane   | dedykowane konto Google zapraszane na wspólne wydarzenia           |
| **C** | Lista zakupów                | 📋 Planowane   | arkusz Google, odhaczanie na iPadzie                               |
| **2** | Radar opadów                 | 📋 Planowane   | RainViewer lub IMGW; wymaga biblioteki mapowej, na iOS 10 niepewne |
| **3** | Wyszukiwarka miast           | 🅿️ Zaparkowane | Pole tekstowe + geocoding API Open-Meteo                           |

Etapy B i C wymagają warstwy pośredniej (n8n na Hetznerze), która trzyma sekrety po swojej stronie i wystawia iPadowi gotowy JSON. Strona przeniesie się wtedy z GitHub Pages na własny serwer - repo zostaje jako źródło kodu.
