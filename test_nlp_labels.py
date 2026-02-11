from backend.utils.bio_nlp import extract_bio_entities

text = "Ibuprofen is used to treat fever and pain in pediatric patients with Chagas disease. It inhibits COX-1 and COX-2."
entities = extract_bio_entities(text)

print(f"Found {len(entities)} entities:")
for e in entities:
    # Need to handle potential missing keys if I messed up
    types = e.get('types', 'N/A')
    print(f"Text: '{e['text']}' | Label: '{e['label']}' | CUI: {e['umls_id']} | Types: {types}")
