---
"think-app": patch
---

Fix code quality issues for release readiness

- Extract Poppler version to workflow variable to prevent future breakage
- Create shared useDocumentUpload hook to reduce code duplication
- Add error logging to Electron temp file cleanup
- Add empty PDF validation to reject image-only/scanned PDFs
- Simplify Vite PDF.js worker configuration
