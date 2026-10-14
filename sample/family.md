# Familie Bauer

Everything the app shows lives in this file. Edit it, reload, done.
Prose like this paragraph is ignored — only the ```family block below is parsed.

This is the made-up sample family. Your own goes into `data/family.md`, which
the app picks up instead whenever it exists — see the README.

## Syntax

| Statement | Meaning |
| --- | --- |
| `person <id> "<Name>" key=value ...` | declares a person. Keys: `born`, `died`, `photo`, `maiden`, `nick`, `note`, `sex` (`m` or `f`), `birthplace`, `deathplace`, `job`, `lives`, `photos`, `birthcountry`, `deathcountry`, `country` (where they live), `nationality` — countries as ISO codes: `DE`, `PT` |
| `<a> + <b> married=1956 divorced=1974` | a partnership. Remarriage = a second `+` line with the new partner |
| `<a> + <b> together=2015 separated=2020` | an unmarried couple — `together` instead of `married`, `separated` instead of `divorced` |
| `<a> + <b> divorced=?` | `?` or `true` instead of a date: it happened, the year is unknown or nobody's business — no year is shown |
| `<a> + <b> -> <child>, <child>` | children of that partnership |
| `<a> + <b> adopted=<child>, <child>` | children of that partnership who were adopted — no `->` needed for them |
| `<a> -> <child>` | children whose second parent is unknown |
| `me <id>` | whose point of view the captions take until someone says who they are — Tante, Cousine, Schwager. Optional: the rest of the file is written from nobody's point of view |
| `%% ...` | comment |

Ids are the deep-link handles (`#/p/klaus`), so keep them short and lowercase.
Photos are file names inside the `photos/` folder next to this file.
`sex` only picks the word for a relation (Onkel or Tante); leave it out and the caption says both.

## The tree

```family
me jonas

%% ---- Generation 1 -------------------------------------------------------
person heinrich  "Heinrich Bauer"    sex=m born=1931-04-02 died=2011-08-17 photo=heinrich.svg photos=haus-lindau.svg birthplace=Lindau birthcountry=DE deathplace=Lindau deathcountry=DE job=Schreiner note="Baute das Haus in Lindau."
person elisabeth "Elisabeth Bauer"   sex=f born=1934-11-23 maiden=Vogt photo=elisabeth.svg nick=Oma birthplace=Kempten lives=Lindau
person werner    "Werner Schmitt"    sex=m born=1935-06-30 died=2019-02-11
person ingrid    "Ingrid Schmitt"    sex=f born=1939-09-08 maiden=Hoffmann photo=ingrid.svg

heinrich + elisabeth married=1956-05-19 -> klaus, brigitte
werner + ingrid married=1960 -> sabine, thomas

%% ---- Generation 2 -------------------------------------------------------
person klaus    "Klaus Bauer"        sex=m born=1958-01-14 job=Lehrer lives=Lindau note="Erzählt jedes Jahr dieselbe Bootsgeschichte."
person sabine   "Sabine Schmitt"     sex=f born=1962-07-21
person carmen   "Carmen Bauer"       sex=f born=1968-03-05 maiden=Ortiz birthcountry=ES nationality="ES, DE"
person brigitte "Brigitte Keller"    sex=f born=1961-10-02 maiden=Bauer
person martin   "Martin Keller"      sex=m born=1959-12-19
person thomas   "Thomas Schmitt"     sex=m born=1965-04-27 nick=Tommy
person petra    "Petra Schmitt"      sex=f born=1967-08-30 maiden=Lange

%% Married, divorced, married again — all three states in one branch.
klaus + sabine married=1984-06-09 divorced=1996 -> nina, jonas
klaus + carmen married=2001-09-15 -> luca
brigitte + martin married=1988-05-28 -> felix, hanna
%% Marie was adopted: adopted= makes her their child and marks her as such.
thomas + petra married=1992 adopted=marie

%% ---- Generation 3 -------------------------------------------------------
person nina  "Nina Falk"    sex=f born=1986-02-17 maiden=Bauer
person tim   "Tim Falk"     sex=m born=1984-11-04
person jonas "Jonas Bauer"  sex=m born=1989-05-23 lives=Lissabon country=PT job=Architekt
person luca  "Luca Bauer"   sex=m born=2003-07-12
person felix "Felix Keller" sex=m born=1990-03-31
person ayla  "Ayla Keller"  sex=f born=1991-01-25 maiden=Demir
person hanna "Hanna Keller" sex=f born=1993-06-14
person marie "Marie Schmitt" sex=f born=1994-10-09

nina + tim married=2014-08-16 -> mia, ben
felix + ayla married=2019-06-01 -> emil

%% ---- Generation 4 -------------------------------------------------------
person mia  "Mia Falk"      sex=f born=2016-04-03
person ben  "Ben Falk"      sex=m born=2019-09-27
person emil "Emil Keller"   sex=m born=2022-12-05
```
