# Query Generator

An AI-powered SQL query generation tool that converts natural language into SQL queries using OpenAI's GPT models and vector embeddings.

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- OpenAI API Key

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Mmd4LIFE/query-generator.git
   cd query-generator
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env and add your OpenAI API key and other settings
   ```

3. **Start the application**
   ```bash
   docker-compose up -d
   ```

4. **Access the application**
   - Frontend: http://localhost:3000 (or your configured FRONTEND_PORT)
   - Backend API: http://localhost:8000 (or your configured BACKEND_PORT)
   - API Documentation: http://localhost:8000/docs (or your configured BACKEND_PORT)

## 🔧 Configuration

All configuration is managed through the `.env` file. Key settings:

```env
# Required
OPENAI_API_KEY=your_openai_api_key_here
SECRET_KEY=your_secret_key_here

# Admin User (customize as needed)
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123

# Optional (with defaults)
POSTGRES_DB=qg
POSTGRES_USER=qg
POSTGRES_PASSWORD=qg
BACKEND_PORT=8000
FRONTEND_PORT=3000
```

## 📖 Usage

1. **Login** with the admin credentials (configured in `.env`)
2. **Upload your database schema** by creating a catalog
3. **Add knowledge** about your database (tables, relationships, etc.)
4. **Generate queries** by describing what you want in natural language
5. **Review and execute** the generated SQL

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (Next.js)     │◄──►│   (FastAPI)     │◄──►│   (PostgreSQL)  │
│   Port: 3000    │    │   Port: 8000    │    │   Port: 5432    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📝 API Documentation

Once running, visit http://localhost:8000/docs (or your configured BACKEND_PORT) for interactive API documentation.