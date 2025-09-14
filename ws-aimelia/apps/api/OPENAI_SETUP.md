# 🤖 OpenAI Integration Setup

This guide shows you how to configure and use OpenAI AI features in your Aimelia API.

## 🔑 API Key Configuration

### 1. Set Your OpenAI API Key

Add your API key to your environment variables:

```bash
# Add to your .env file
echo 'OPENAI_API_KEY=your_openai_api_key_here' >> .env
```

### 2. For Production (Render)

In your Render dashboard, add the environment variable:
- **Key**: `OPENAI_API_KEY`
- **Value**: `your_openai_api_key_here`

## 🧪 Testing the Integration

### Run the Test Script

```bash
cd ws-aimelia/apps/api
python test_ai.py
```

This will test:
- ✅ Email classification
- ✅ Meeting brief generation  
- ✅ Email summarization
- ✅ AI service connectivity

## 🚀 Available AI Features

### 1. **Email Triage & Classification**
- **Endpoint**: `POST /emails/triage/run`
- **Features**:
  - Intelligent email categorization (Urgent, Important, Payroll, Tax, etc.)
  - Urgency scoring (1-5)
  - Confidence levels
  - Rule-based + AI hybrid approach

### 2. **Email Analysis**
- **Endpoint**: `POST /emails/analyze/{email_id}`
- **Features**:
  - Detailed email analysis
  - AI-generated summaries
  - Suggested responses
  - Urgency assessment

### 3. **Email Thread Summarization**
- **Endpoint**: `POST /emails/summarize-thread`
- **Features**:
  - Multi-email thread analysis
  - Key points extraction
  - Decision tracking
  - Action item identification

### 4. **Meeting Brief Generation**
- **Endpoint**: `POST /calendar/brief/{event_id}`
- **Features**:
  - AI-powered meeting briefs
  - Context from recent emails
  - Talking points generation
  - Attendee communication history

### 5. **Upcoming Meeting Briefs**
- **Endpoint**: `GET /calendar/briefs/upcoming`
- **Features**:
  - Batch brief generation for next 24 hours
  - Comprehensive meeting preparation
  - Context-aware insights

## 📊 API Usage Examples

### Email Triage
```bash
curl -X POST "https://your-api.com/emails/triage/run" \
  -H "Authorization: Bearer your-token"
```

**Response:**
```json
{
  "status": "ok",
  "message_count": 10,
  "triaged_emails": [
    {
      "id": "email-id",
      "subject": "Urgent: Budget Review",
      "from": "ceo@company.com",
      "triage": {
        "category": "Urgent",
        "urgency": 5,
        "confidence": 0.95,
        "method": "ai"
      }
    }
  ],
  "summary": {
    "urgent": 2,
    "important": 5,
    "low_priority": 3
  }
}
```

### Meeting Brief
```bash
curl -X POST "https://your-api.com/calendar/brief/event-id" \
  -H "Authorization: Bearer your-token"
```

**Response:**
```json
{
  "status": "ok",
  "event_id": "event-id",
  "brief_html": "<h3>Meeting Brief</h3><p>AI-generated content...</p>",
  "metadata": {
    "subject": "Q4 Review",
    "start_time": "2024-01-15T14:00:00Z",
    "attendees": ["ceo@company.com", "cfo@company.com"]
  }
}
```

## 🔧 Configuration Options

### AI Service Settings

The AI service automatically configures itself based on your `OPENAI_API_KEY`. You can customize behavior by modifying `ai_service.py`:

- **Model**: Currently using `gpt-3.5-turbo` (cost-effective)
- **Temperature**: 0.3-0.5 for consistent results
- **Max Tokens**: Optimized for each use case
- **Fallback**: Graceful degradation when AI is unavailable

### Cost Management

- **Email Classification**: ~100-200 tokens per email
- **Meeting Briefs**: ~500-800 tokens per brief
- **Email Summaries**: ~200-400 tokens per summary
- **Estimated Cost**: ~$0.001-0.005 per email processed

## 🛡️ Security & Privacy

- ✅ **API Key Security**: Stored in environment variables
- ✅ **Data Privacy**: Emails processed securely via OpenAI API
- ✅ **No Data Storage**: AI doesn't store your email content
- ✅ **Fallback Mode**: Works without AI when needed
- ✅ **Error Handling**: Graceful degradation on failures

## 🔍 Monitoring & Debugging

### Check AI Service Status
```bash
curl -X GET "https://your-api.com/emails/triage/run"
```

### View Logs
```bash
# Check application logs for AI service status
tail -f /var/log/aimelia.log | grep -i "ai\|openai"
```

### Common Issues

1. **"AI disabled" messages**: Check `OPENAI_API_KEY` is set
2. **Rate limiting**: OpenAI has usage limits per minute
3. **Token limits**: Large emails may hit token limits
4. **Network issues**: Check internet connectivity

## 🚀 Next Steps

1. **Test the integration** with `python test_ai.py`
2. **Authenticate** with Microsoft Graph via `/auth/login`
3. **Run email triage** via `/emails/triage/run`
4. **Generate meeting briefs** via `/calendar/briefs/upcoming`
5. **Monitor usage** and adjust as needed

Your Aimelia AI PA is now powered by OpenAI! 🎉
