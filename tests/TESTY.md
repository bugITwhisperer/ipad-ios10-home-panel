# Testy

## Uruchomienie

Z głównego folderu repo, jedną komendą (Node 22+):

```bash
node --test
```

Uruchamia oba zestawy: `tests/test-todo-shopping-list.js` (30 testów, etap C) i
`tests/test-panel.js` (54 testy, panel). Każdy można też puścić osobno:

```bash
node tests/test-panel.js     # czytelny wydruk PASS/FAIL
node --test tests/test-todo-shopping-list.js
```

Strefa `Europe/Warsaw` jest ustawiana w samych plikach testów, więc nie trzeba
już podawać `TZ=` ani generować `panel-app.js` — testy czytają `index.html`
bezpośrednio.

## Pliki

| Plik                    | Rola                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `../index.html`         | źródło panelu — cała logika w bloku `<script>`              |
| `../gscript/Code.gs`    | backend Apps Script (etap C) — wklejany do edytora Google   |
| `test-panel.js`         | testy panelu: rotacja, noc, pogoda, motyw                   |
| `fixtures.js`           | generator sztucznych odpowiedzi Open-Meteo                  |
| `test-todo-shopping-list.js`     | testy etapu C: skrypt Google + widok Zakupy/ToDo + JSONP    |
| `helpers.js`            | ładuje `index.html` i `Code.gs` do testów bez przeglądarki  |

Testy nie wychodzą do sieci. `fixtures.js` buduje odpowiedź o tym samym
kształcie co prawdziwe API, z podanymi godzinami wschodu i zachodu — dzięki
temu da się sprawdzić zimę, lato i zmianę czasu bez czekania na kalendarz.
Etap C używa atrap arkusza i przeglądarki, więc nie potrzebuje konta Google.

## Grupy

| Grupa  | Zakres                                                      |
| ------ | ----------------------------------------------------------- |
| **5**  | rotacja widoków — kolejność, czasy, brak wycieków przy renderze |
| **6**  | dotknięcie w dzień — pauza, powrót, przedłużanie             |
| **7**  | tryb nocny — 00:30, świt, okno 30 s, zachowanie przez świt   |
| **8**  | długie działanie — doba obrotów, timery, zaślepki            |
| **9**  | zgodność z iOS 10 — skan składni JS i CSS                    |
| **10** | dwa paski godzinowe — zakresy, dropdown, 3/5/7 dni           |
| **11** | mini pogoda w nagłówku — zawartość, przełączanie, braki danych |
| **12** | motyw jasny/ciemny — przełączanie, zapis, noc, kontrast        |
| **A**  | etap C, skrypt Google — odczyt list, północ, klucz, odhaczanie |
| **B**  | etap C, iPad — konfiguracja, lista, offline, JSONP, XSS        |
| **R**  | regresja — logika pogody i przeładowanie o 4:00              |

## Co wyłapały

| Test   | Znalezisko                                                              |
| ------ | ----------------------------------------------------------------------- |
| **16** | widok godzinowy po zachodzie pokazywał dobę nieaktualnych godzin        |
| **20** | przeładowanie uruchomione dokładnie o 4:00 wpadało w pętlę              |
| **22** | przy zmianie czasu doba ma 23 lub 25 godzin, nie 24                     |
| **32** | `sunrise` z innej daty niż bieżąca gasił ekran już wieczorem            |

## Czego testy nie sprawdzą

Dwie rzeczy wymagają fizycznego iPada:

- czytelność z ~2 m
- zniknięcie paska Safari po uruchomieniu z ikony na ekranie początkowym
