# PLACEMENT REBUILD — PROGRESS LEDGER

This file is the memory of the build. It replaces the "long chat."
- Every checkpoint session READS this file first (to know what came before).
- Every checkpoint session APPENDS one entry here as its LAST action.
- Trust git (pushed SHAs), not prose. If an entry claims a SHA, it must exist.

Do not delete past entries. Append only.

---

## Format for each entry (copy this shape)

### CP-XX — <label> — <YYYY-MM-DD>
- **Commit SHA:** <sha>  (pushed to dev: yes/no)
- **What was built:** <1-2 lines>
- **Verified (happy path):** <what was checked and how>
- **Verified (unhappy path):** <interrupted / empty / concurrent / ineligible etc.>
- **Screenshots:** <paths, for UI checkpoints>
- **Migration needed:** <none | file created, AWAITING MANUAL APPLICATION>
- **Next checkpoint must know:** <anything non-obvious>

---

## Log

_(entries appended below by each checkpoint session)_