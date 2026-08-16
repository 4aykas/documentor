<!-- A generic proposal that opens with a cover page, to copy from. Nothing
     here is any company's wording: every commercial sentence is placeholder
     prose a template owner replaces. The data file that drives it must set
     "cover": true — the cover zones below only mean anything then. See
     templates/offer.example.md for the same proposal without a cover. -->

# {{kind}}

ENGINEERING SERVICE

PROJECT — {{project}}

{{?stage}}
{{stage}}

{{/?}}
<!-- The cover's FIRST rule closes the panel: the title and everything above
     this line are drawn inside a hairline border. -->

---

<!-- A header row with nothing in it says "these are labelled values, not a
     grid" — the only way Markdown can say it. The renderers drop the empty
     row, drop the row rules, mute the labels, and let the pairs hug the left
     instead of stretching across the page. -->

| | |
|---|---|
{{?number}}| Proposal No. | {{number}} |
{{/?}}{{?docNumber}}| Doc. No. | {{docNumber}} |
{{/?}}| Date | {{date}} |
{{?rev}}| Rev. | {{rev}} |
{{/?}}

<!-- A blockquote between the cover's rules is the statement band: a tinted
     brand panel dropped into the middle of the page, its first line set as
     large display type. Its text is this template's own, verbatim — the band
     is a place to put a sentence, not a sentence documentor writes. -->

> {{project}}
>
> {{kind}} — engineering service, prepared for the Client's assignment.
>
> Issued {{date}}

{{author.name}}

{{?author.phone}}
{{author.phone}}

{{/?}}
{{author.email}}

<!-- The cover's LAST rule opens the foot: everything below it is pinned to
     the bottom of the page. Replace these lines with your own entity. -->

---

Contractor entity

Street and number

Postcode and city

Country

{{@pagebreak}}

{{?summary}}
## MANAGEMENT SUMMARY

{{@summary}}
{{/?}}

## SCOPE OF SERVICE

{{section:scope}}

## SCHEDULE

{{@schedule}}

## RATES AND PRICE

{{@budget}}

All services are provided on a reimbursable basis according to the approved
time sheet.

{{?sections.assumptions}}
## ASSUMPTIONS

{{section:assumptions}}
{{/?}}

{{?sections.exclusions}}
## EXCLUSIONS

{{section:exclusions}}
{{/?}}

## INVOICING AND PAYMENT

- All prices are stated and shall be paid without VAT.
- Invoices are issued monthly against the approved scope of services.
- Payment is due within the agreed number of calendar days of the invoice date.

{{?annex}}
{{@pagebreak}}
## ANNEX A — DELIVERABLES

{{@annex}}
{{/?}}

Contractor: {{author.name}} {{author.email}}
