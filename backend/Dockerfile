FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

WORKDIR /app

# Install Python 3.10 and system dependencies
RUN apt-get update && apt-get install -y \
    software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y \
    python3.10 \
    python3.10-venv \
    python3.10-dev \
    python3-pip \
    gcc \
    g++ \
    curl \
    zstd \
    build-essential \
    tesseract-ocr \
    libtesseract-dev \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Make python3.10 the default python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Copy requirements first for better caching
COPY backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip

# Install PyTorch with CUDA support FIRST (before requirements.txt)
# RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124

# Install remaining requirements (torch already installed with CUDA, pip will skip it)
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
