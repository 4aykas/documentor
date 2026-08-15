# Kitchen Sink — Зразок — Wzorzec

An opening paragraph in English, with **bold**, *italic*, `inline code`, and a
[link](https://example.com) so every inline type is on the page.

## Розділ українською

Привіт, ґуля і їжак. Ці літери — і, ї, ґ, є — існують лише в українській
абетці, тож якщо шрифт підставився, це видно одразу.

## Sekcja po polsku

Zażółć gęślą jaźń. Śródmieście, łódź, ćma, źrebię, żaba — polskie znaki
diakrytyczne w jednym zdaniu.

### A third-level heading

1. First ordered item
2. Second ordered item
3. Third ordered item

- Unordered item
  - Nested one level deeper
  - And a sibling
- Back to the outer level

> A quoted paragraph, set apart by a rule on its left edge.
>
> A second quoted paragraph, to prove the spacing between them.

```ts
const answer: number = 42;
console.log(`the answer is ${answer}`);
```

![A red square, a grey circle and a black bar](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCAyNDAgODAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIGZpbGw9IiNGNkY2RjQiLz48cmVjdCB4PSI4IiB5PSI4IiB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiNEQTI5MUMiLz48Y2lyY2xlIGN4PSIxMjAiIGN5PSI0MCIgcj0iMjgiIGZpbGw9IiM4OThEOEQiLz48cmVjdCB4PSIxNjgiIHk9IjI0IiB3aWR0aD0iNjQiIGhlaWdodD0iMzIiIGZpbGw9IiMxQTFBMUEiLz48L3N2Zz4=)

The image above is a `data:` URI on purpose: the renderer fetches nothing, so a
fixture that referenced a file on disk would be testing the wrong thing.

| Item | Quantity | Unit price | Currency | Total |
|:-----|---------:|-----------:|:--------:|------:|
| Widget | 12 | 4.50 | EUR | 54.00 |
| Gadget | 3 | 129.99 | EUR | 389.97 |
| Sprocket, extra-long replacement part name to force the cell to wrap onto two lines | 140 | 0.35 | EUR | 49.00 |

---

A closing paragraph after a horizontal rule, long enough to run onto a second
line so that the leading between wrapped lines is visible in the baseline
image and a change to it cannot pass unnoticed.

## A table too wide for the page

Eighteen columns cannot each have a readable minimum width inside the portrait
text column, so this one is drawn on a landscape sheet of its own. Where that
line is drawn, and how the sideways page is asked for, are decided by the two
renderers together rather than by this fixture.

| Discipline | W01 | W02 | W03 | W04 | W05 | W06 | W07 | W08 | W09 | W10 | W11 | W12 | W13 | W14 | W15 | W16 | W17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Lead Electrical Engineer | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week | 7 days / week |
| BIM Coordinator | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week | 2 days / week |

A paragraph after the wide table, on a portrait page again — the rotation is
scoped to the one table, not to everything that follows it.
