---
"think-app": patch
---

Replace unmaintained pysqlcipher3 with rotki-pysqlcipher3

- `pysqlcipher3` is no longer maintained (last updated 2021)
- `rotki-pysqlcipher3` is actively maintained with cross-platform wheels
- Drop-in replacement using the same `pysqlcipher3` import namespace
- Python version locked to 3.12.x (rotki-pysqlcipher3 wheels only support 3.11-3.12)
