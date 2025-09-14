# Enhanced Aimelia Features

## 🧠 **Context-Aware AI System**

Aimelia now features a sophisticated AI system that combines:
- **Persona-driven responses** (Tom Stanley's voice and style)
- **Knowledge base (RAG)** for retrieving relevant context
- **Few-shot learning** for consistent tone and style
- **Context-aware generation** for all AI tasks

## 🎯 **Key Features**

### **1. Persona System**
- **File**: `app/persona/tom_profile.md`
- **Purpose**: Defines Tom Stanley's professional voice, style, and guardrails
- **Usage**: Automatically injected into every AI generation

### **2. Knowledge Base (RAG)**
- **Technology**: PostgreSQL + pgvector
- **Purpose**: Store and retrieve contextual information
- **Sources**: Emails, meetings, documents, policies
- **Retrieval**: Vector similarity search for relevant context

### **3. Context Builder**
- **File**: `app/context_builder.py`
- **Purpose**: Unifies persona, knowledge, and few-shots
- **Usage**: Called by all AI generation endpoints

### **4. Few-Shot Examples**
- **File**: `app/fewshots.py`
- **Purpose**: Provides curated examples for consistent tone
- **Coverage**: Email replies, meeting briefs, triage, analysis

## 🚀 **New API Endpoints**

### **Enhanced Email Triage**
```http
POST /ai/emails/triage/enhanced
Content-Type: application/json

{
  "subject": "VAT return deadline approaching",
  "sender": "hmrc@hmrc.gov.uk",
  "body": "Your VAT return is due...",
  "client_context": {"client_name": "Public House Group"}
}
```

### **Context-Aware Email Drafts**
```http
POST /ai/emails/drafts/enhanced
Content-Type: application/json

{
  "original_email": {
    "subject": "Payroll query",
    "from": {"emailAddress": {"address": "client@example.com"}},
    "bodyPreview": "When will our payslips be ready?"
  },
  "context": "Client needs payslips for month-end"
}
```

### **Enhanced Meeting Briefs**
```http
POST /ai/calendar/briefs/enhanced
Content-Type: application/json

{
  "event": {
    "subject": "Q3 Board Review",
    "attendees": [{"emailAddress": {"address": "ceo@client.com"}}],
    "start": {"dateTime": "2024-01-15T10:00:00Z"}
  },
  "recent_emails": [...]
}
```

### **Knowledge Base Search**
```http
GET /ai/knowledge/search?query=VAT+compliance&top_k=5&source_filter=policy
```

### **Generic Context-Aware Generation**
```http
POST /ai/context-aware-generation
Content-Type: application/json

{
  "task": "analysis",
  "meta": {"client": "Public House Group", "topic": "payroll costs"},
  "query": "Public House Group payroll costs analysis",
  "top_k": 6
}
```

## 🛠️ **Setup Instructions**

### **1. Database Setup**
```bash
# Enable pgvector extension
psql -d your_database -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Run migrations
python3 migrate.py
python3 migrate_knowledge_base.py
```

### **2. Environment Variables**
```bash
# Add to your .env file
OPENAI_API_KEY=your_openai_api_key
ENCRYPTION_KEY=your_fernet_key
DATABASE_URL=postgresql://user:pass@host:port/db
```

### **3. Deploy Enhanced System**
```bash
./deploy_enhanced.sh
```

## 📊 **Knowledge Base Management**

### **Index New Knowledge**
```python
from app.knowledge_base import knowledge_retriever

# Index an email
await knowledge_retriever.index_email(
    db, email_id, subject, body, sender
)

# Index meeting notes
await knowledge_retriever.index_meeting(
    db, meeting_id, title, notes, attendees
)

# Store custom knowledge
await knowledge_retriever.store_chunk(
    db, "policy", "vat_guide", "VAT Guidelines", content
)
```

### **Search Knowledge**
```python
# Retrieve relevant chunks
chunks = await knowledge_retriever.retrieve_chunks(
    db, "VAT compliance hospitality", top_k=5
)
```

## 🎨 **Persona Customization**

Edit `app/persona/tom_profile.md` to customize:
- **Voice and tone**
- **Writing style**
- **Guardrails and safety rules**
- **Decision-making framework**
- **Common scenarios**

## 📈 **Monitoring and Analytics**

### **Health Check**
```http
GET /health
```

Returns:
- AI service status
- Knowledge base statistics
- Persona loading status
- System health metrics

### **Logging**
All AI operations are logged with:
- Input context
- Generated responses
- Knowledge retrieval results
- Performance metrics

## 🔒 **Safety and Security**

### **Built-in Guardrails**
- **Never auto-send emails** - always create drafts
- **Flag financial information** - highlight money/banking details
- **Confirm sensitive changes** - VAT, payroll, HMRC matters
- **UK compliance focus** - proper spelling and regulations

### **Privacy Protection**
- **No raw email storage** - only processed chunks
- **Encrypted tokens** - secure Microsoft Graph access
- **Audit logging** - track all AI operations
- **Data retention** - configurable cleanup policies

## 🚀 **Performance Optimization**

### **Vector Indexing**
- **HNSW index** for fast similarity search
- **Chunking strategy** for optimal retrieval
- **Embedding caching** for repeated queries

### **Context Optimization**
- **Smart chunking** (500-1000 tokens)
- **Relevance filtering** by source and context
- **Few-shot selection** based on task type

## 🔧 **Troubleshooting**

### **Common Issues**

1. **pgvector not available**
   ```bash
   # Install pgvector extension
   psql -d your_database -c "CREATE EXTENSION vector;"
   ```

2. **OpenAI API errors**
   ```bash
   # Check API key and quota
   export OPENAI_API_KEY=your_key
   ```

3. **Knowledge base empty**
   ```bash
   # Run knowledge base migration
   python3 migrate_knowledge_base.py
   ```

4. **Persona not loading**
   ```bash
   # Check file permissions
   ls -la app/persona/tom_profile.md
   ```

## 📚 **Next Steps**

1. **Seed knowledge base** with your existing documents
2. **Customize persona** for your specific needs
3. **Add few-shot examples** from your best communications
4. **Monitor performance** and adjust context retrieval
5. **Expand knowledge sources** (client docs, policies, etc.)

---

**Aimelia Enhanced v2.0** - Your intelligent, context-aware AI assistant! 🎉
