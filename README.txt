Je ziet nu: 429 "You exceeded your current quota"

Dat is geen code-bug. Dat betekent:
- billing/credits niet (goed) ingesteld voor jouw OpenAI project/account, OF
- je hebt je limiet bereikt, OF
- je zit tegen een rate limit.

STAPPEN
1) OpenAI Dashboard -> Billing/Usage -> check credits/billing.
2) Maak evt een nieuwe key (en revoke gelekte keys).
3) Zet key in .env (aanrader) of PowerShell.
4) Start backend opnieuw.

TECHNISCHE VERBETERING
Deze versie returned 429 naar de app, zodat je in de UI "Backend fout (429)" ziet i.p.v. 500.
