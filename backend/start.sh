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

# Pull the model if not already present
echo "📥 Ensuring llama3.1 is available..."
ollama pull llama3.1

# Start the FastAPI application
echo "🌐 Starting FastAPI application on port $PORT..."
exec uvicorn app:app --host 0.0.0.0 --port $PORT
