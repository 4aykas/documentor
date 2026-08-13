# {{kind}} — {{project}}

ENGINEERING SERVICE

{{?stage}}Stage: {{stage}}{{/?}}
{{?number}}Proposal No.: {{number}}{{/?}}
{{?docNumber}}Doc. No.: {{docNumber}}{{/?}}
Date: {{date}}{{?rev}} | Rev.: {{rev}}{{/?}}

Contact: {{author.name}}{{?author.phone}}, {{author.phone}}{{/?}}, {{author.email}}

## GENERAL

{{section:general}}

{{?summary}}
## MANAGEMENT SUMMARY

{{@summary}}
{{/?}}

## SCOPE OF SERVICE

{{section:scope}}

## SCHEDULE

{{@heatmap}}

Shading scales with hours per week; the darkest cell is the busiest.

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

## REPORTING

- Progress reports — monthly.
- Activities are planned and agreed with the client's responsible persons.

{{?annex}}
{{@pagebreak}}
## ANNEX A — DELIVERABLES

{{@annex}}
{{/?}}

Contractor: {{author.name}} {{author.email}}
