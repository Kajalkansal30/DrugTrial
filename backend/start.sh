#!/bin/bash

# Start Ollama server in the background
echo "🚀 Starting Ollama server..."
ollama serve &

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama server to respond..."
until curl -s http://localhost:11434/api/tags > /dev/null; do
    sleep 2
done
echo "✅ Ollama server is up!"

# Pull the model (configurable via OLLAMA_MODEL env var)
MODEL=${OLLAMA_MODEL:-"llama3.1"}
echo "📥 Ensuring ${MODEL} is available..."
ollama pull ${MODEL}

# Start the FastAPI application
echo "🌐 Starting FastAPI application on port $PORT..."
exec uvicorn app:app --host 0.0.0.0 --port $PORT
