# Node.js Backend Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY src ./src

# Create upload directories
RUN mkdir -p uploads/fda uploads/trials

# Expose port
EXPOSE 4000

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "src/server.js"]
