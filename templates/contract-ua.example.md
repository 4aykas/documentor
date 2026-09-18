<!-- A bilingual Ukrainian/English contract, to copy from.

     Build it with:
       documentor contract <data>.contract.json --theme plain --to pdf,docx

     Nothing here is any company's wording: every sentence is placeholder
     prose a template owner replaces, and the commercial and legal substance
     lives entirely in the data file. See templates/contract-ua.example.json
     for the data this template expects.

     What lives where:

     - This file carries only what is the same in every contract: the shape,
       the running order, and the sentences your company says the same way
       every time. No party, no number, no date, no clause text.
     - The data file carries everything that changes: the number, the date,
       the parties, and every article and clause in both languages.
     - The articles directive — written with braces below, and deliberately
       NOT named with them in this comment, because the template parser reads
       a token inside a comment exactly as it reads one outside — prints the
       numbered articles. It is a directive rather than a loop because this
       template language has none by design: anything needing logic lives in
       the assembler, under tests, not in a template where nothing checks it.

     The two languages are equally authentic versions of the same obligation,
     not an original and a translation. That is why the data file requires
     both for every clause and refuses a pair with one side missing: a
     bilingual contract printed with one column blank is not a tidier
     contract, it is a contract with a hole in it. -->

# {{title.uk}} № {{number}}

{{title.en}} No. {{number}}

{{place.uk}}, {{date}} — {{place.en}}, {{date}}

{{@parties}}

{{?sections.preamble}}
{{section:preamble}}
{{/?}}
{{^sections.preamble}}
далі разом іменовані «Сторони», уклали даний Договір про нижченаведене:

hereinafter jointly referred to as "Parties", conclude the following
Contract on the following:
{{/^}}

{{@articles}}

{{?sections.annex}}
{{@pagebreak}}
{{section:annex}}
{{/?}}

{{@pagebreak}}

## Реквізити та підписи Сторін · Requisites and Signatures of the Parties

{{@signatures}}
