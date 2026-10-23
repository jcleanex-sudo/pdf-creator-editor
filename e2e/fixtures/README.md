# Synthetic PDF fixtures

`password.pdf` contains one page with the text `ENCRYPTED TEST`, no private data, and AES-256 encryption. It was generated locally using PyMuPDF for password-copy integration tests. Test user password: `test-pass`; owner password: `test-owner`.

Regeneration (PyMuPDF required only for maintaining this fixture):

```python
import fitz
pdf = fitz.open()
page = pdf.new_page()
page.insert_text((60, 100), "ENCRYPTED TEST")
pdf.save("password.pdf", encryption=fitz.PDF_ENCRYPT_AES_256,
         owner_pw="test-owner", user_pw="test-pass",
         permissions=fitz.PDF_PERM_PRINT | fitz.PDF_PERM_COPY)
```

Other browser tests generate their synthetic PDF inputs at runtime. User-provided PDFs must never be added to this directory.
