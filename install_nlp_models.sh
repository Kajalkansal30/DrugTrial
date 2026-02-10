#!/bin/bash
# Install spaCy and scispacy models
# Run this script after activating your virtual environment

echo "🔬 Installing spaCy and SciSpacy models for medical NLP..."
echo ""

# Install scispacy
echo "1️⃣ Installing scispacy..."
pip install scispacy
echo ""

# Install base spaCy model
echo "2️⃣ Installing spaCy base model (en_core_web_sm)..."
pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.7.1/en_core_web_sm-3.7.1-py3-none-any.whl
echo ""

# Install SciSpacy medical model
echo "3️⃣ Installing SciSpacy medical model (en_core_sci_sm)..."
pip install https://s3-us-west-2.amazonaws.com/ai2-s2-scispacy/releases/v0.5.4/en_core_sci_sm-0.5.4.tar.gz
echo ""

# Verify installation
echo "✅ Verifying installation..."
python -c "import spacy; import scispacy; print('spaCy version:', spacy.__version__); print('scispacy version:', scispacy.__version__)"
echo ""

echo "🎉 Installation complete!"
echo ""
echo "Available models:"
echo "  - en_core_web_sm (general English)"
echo "  - en_core_sci_sm (biomedical/scientific text)"
