# Payment date correction worksheet

This sheet lists completed receipts whose stored `paid_on` needs a source document before anyone changes it.

Do not guess a date. Leave the blank columns empty until the original receipt, mobile-money statement, bank record, or cash record has been checked.

Do not run a correction from this file. It is not a script.

A later correction, once a date is verified, changes only `paid_on`. It does not change the amount, the pupil, the receipt number, the account, the allocations, or the outstanding balance. It can move the receipt between days, months, and report periods. The rendered receipt reads `paid_on` from the live payment, so the date printed on that receipt changes with the correction. The receipt number does not.

Do not correct a voided receipt. Do not submit the date that is already stored. If an account already has an opening-balance date, do not move a receipt from on or before that date to after it, or the other way: that changes the physical balance and the correction is refused. Moving a date that stays on the same side of the cutover does not change the physical total, but it still changes period reports. While every opening-balance date is still empty, these 14 receipts can be corrected without crossing a cutover. 30 September 2026 is only a candidate cutover date. It has not been entered.

| Receipt | Amount | Account | Stored paid_on | Verified correct date | Evidence/source | Correction reason | Verified by | Ready to correct? Yes/No |
|---|---:|---|---|---|---|---|---|---|
| BFA-R-2026-0022 | K1,050 | MOBILE_MONEY | 2026-11-09 | | | | | |
| BFA-R-2026-0006 | K450 | MOBILE_MONEY | 2026-12-07 | | | | | |
| BFA-R-2026-0002 | K750 | UNATTRIBUTED | 2026-12-09 | | | | | |
| BFA-R-2026-0007 | K1,000 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0019 | K500 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0020 | K5,090 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0021 | K500 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0023 | K1,200 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0024 | K1,000 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0025 | K600 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0026 | K600 | PETTY_CASH | 2026-12-09 | | | | | |
| BFA-R-2026-0027 | K500 | MOBILE_MONEY | 2026-12-09 | | | | | |
| BFA-R-2026-0012 | K1,090 | MOBILE_MONEY | 20266-04-09 | | | | | |
| BFA-R-2026-0028 | K1,200 | MOBILE_MONEY | 92026-02-08 | | | | | |
