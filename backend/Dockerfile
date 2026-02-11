FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    zstd \
    python3-dev \
    build-essential \
    tesseract-ocr \
    libtesseract-dev \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Copy requirements first for better caching
COPY backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Download and bake in spaCy models + ScispaCy linker data
RUN pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.7.1/en_core_web_sm-3.7.1-py3-none-any.whl \
 && pip install https://s3-us-west-2.amazonaws.com/ai2-s2-scispacy/releases/v0.5.4/en_core_sci_lg-0.5.4.tar.gz

# Pre-download the SciSpaCy linker data (UMLS) to prevent startup timeout
RUN python -c "import spacy; from scispacy.linking import EntityLinker; nlp=spacy.load('en_core_sci_lg'); nlp.add_pipe('scispacy_linker', config={'linker_name':'umls'}); print('Linker cached')"

# Copy application code
COPY . .

# Ensure start script is executable
RUN chmod +x backend/start.sh

# Expose ports
EXPOSE 8201
EXPOSE 11434

# Run the application using the start script
CMD ["bash", "./backend/start.sh"]
