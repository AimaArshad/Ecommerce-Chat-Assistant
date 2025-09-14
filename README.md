# AI-Powered E-commerce Chat Assistant

## 🛠️ Technology Stack

### Frontend
- **React** - Component-based UI framework
- **Vite** - Fast build tool and development server
- **CSS3** - Custom styling with modern layout techniques
- **React Icons** - Beautiful icon library

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web application framework
- **TypeScript** - Type-safe JavaScript development
- **MongoDB** - NoSQL database for product inventory
- **MongoDB Atlas Vector Search** - Semantic search capabilities

### AI/ML Components
- **LangChain** - Framework for developing AI applications
- **LangGraph** - Stateful, conversational AI workflows
- **Google Gemini AI** - Large language model for natural language understanding
- **Google Generative AI Embeddings** - Text embedding generation for semantic search

## 🏗️ Architecture                                    
The application follows a modern full-stack architecture:
Frontend (React) → Backend (Express/Node) → AI Agent (LangChain/LangGraph) → Database (MongoDB)

text

### Key Architectural Components:
1. **Chat Widget Component**: React-based UI component that can be embedded in any e-commerce site
2. **RESTful API**: Express.js backend with endpoints for starting and continuing conversations
3. **AI Agent System**: LangGraph-powered state machine that manages conversational flow
4. **Vector Search**: MongoDB Atlas vector search for semantic product matching
5. **Conversation Persistence**: MongoDB-based checkpointing for maintaining conversation state

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- MongoDB Atlas account
- Google Gemini API key
- npm or yarn package manager

### Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd ecommerce-chat-assistant

# Install backend dependencies
cd server
npm install

# Install frontend dependencies
cd ../client
npm install
Environment Setup
Create a .env file in the server directory:

env
MONGO_ATLAS_URI=your_mongodb_connection_string
GOOGLE_API_KEY=your_google_gemini_api_key
PORT=8000
Running the Application
bash
# Start backend server
cd server
npm run dev

# Start frontend development server
cd ../client
npm run dev

### Features
- Natural language product queries
- Conversational memory with thread management
- Semantic product search using vector embeddings
- Real-time inventory lookup

