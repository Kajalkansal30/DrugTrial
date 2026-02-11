import fitz  # PyMuPDF
import re
from typing import List, Dict, Any
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

def clean_text(text: str) -> str:
    """
    Clean basic whitespace and artifacts.
    """
    if not text:
        return ""
    # Remove multiple newlines and spaces
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def extract_text_by_page(pdf_path: str) -> List[Dict[str, Any]]:
    """
    Extract text page by page with metadata.
    """
    try:
        doc = fitz.open(pdf_path)
        pages = []
        for i, page in enumerate(doc):
            pages.append({
                "page": i + 1,
                "text": page.get_text()
            })
        doc.close()
        return pages
    except Exception as e:
        logger.error(f"Error extracting text from {pdf_path}: {str(e)}")
        return []

def chunk_text_with_meta(pages: List[Dict[str, Any]], chunk_size: int = 1000) -> List[Dict[str, Any]]:
    """
    Split text into chunks while preserving page metadata.
    """
    chunks = []
    for p in pages:
        text = clean_text(p["text"])
        if not text:
            continue
            
        # Simple split for now, tagging each chunk with the page it came from
        for i in range(0, len(text), chunk_size):
            chunks.append({
                "text": text[i:i + chunk_size],
                "page": p["page"]
            })
    return chunks

def process_pdf_document(pdf_path: str) -> Dict[str, Any]:
    """
    Enhanced pipeline for a single PDF with page tracking.
    """
    filename = Path(pdf_path).name
    logger.info(f"Processing PDF for Research Intel: {filename}")
    
    pages = extract_text_by_page(pdf_path)
    chunks = chunk_text_with_meta(pages)
    
    full_text = " ".join([p["text"] for p in pages])
    
    return {
        "source": filename,
        "type": "PDF",
        "full_text": clean_text(full_text),
        "chunks": chunks
    }

if __name__ == "__main__":
    # Test on a known PDF if exists
    test_pdf = "/home/veersa/Projects/Hackathon/DrugTrial/uploads/fda_documents/DNDi-Clinical-Trial-Protocol-BENDITA-V5.pdf"
    if Path(test_pdf).exists():
        doc = process_pdf_document(test_pdf)
        print(f"File: {doc['source']}")
        print(f"Chunks: {len(doc['chunks'])}")
        print(f"First Chunk: {doc['chunks'][0][:200]}...")
