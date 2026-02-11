import logging
import os
from pathlib import Path
from typing import Optional
import pytesseract
from pdf2image import convert_from_path
from PIL import Image

logger = logging.getLogger(__name__)

class OCRProcessor:
    def __init__(self, tesseract_cmd: Optional[str] = None):
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
            
    def extract_text_from_pdf(self, pdf_path: str) -> str:
        """
        Convert PDF to images and run Tesseract OCR on each page.
        """
        logger.info(f"📸 Starting OCR for: {pdf_path}")
        try:
            # Convert PDF to list of PIL Image objects
            # Using 300 DPI for good OCR accuracy
            pages = convert_from_path(pdf_path, 300)
            
            full_text = []
            for i, page in enumerate(pages):
                logger.info(f"📄 Processing page {i+1}/{len(pages)}...")
                text = pytesseract.image_to_string(page)
                full_text.append(f"--- PAGE {i+1} ---\n{text}")
                
            return "\n\n".join(full_text)
        except Exception as e:
            logger.error(f"OCR Failed for {pdf_path}: {e}")
            return f"OCR Error: {str(e)}"

    @staticmethod
    def is_ocr_needed(text: str, min_chars: int = 200) -> bool:
        """
        Simple heuristic: if extracted text is suspiciously short, we might need OCR.
        """
        if not text or len(text.strip()) < min_chars:
            return True
        return False

if __name__ == "__main__":
    # Test (requires tesseract and a sample pdf)
    processor = OCRProcessor()
    # sample = "path/to/scanned.pdf"
    # print(processor.extract_text_from_pdf(sample))
