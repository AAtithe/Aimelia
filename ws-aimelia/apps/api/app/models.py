from sqlalchemy import Column, String, JSON, TIMESTAMP, Integer, ForeignKey, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.sql import func
import uuid
from .db import Base

class Client(Base):
    __tablename__ = "clients"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String)
    domains = Column(ARRAY(String))
    tags = Column(ARRAY(String))
    last_kpis = Column(JSON)
    last_contacted_at = Column(TIMESTAMP(timezone=True))

class Contact(Base):
    __tablename__ = "contacts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id"))
    name = Column(String)
    email = Column(String)
    title = Column(String)
    last_seen = Column(TIMESTAMP(timezone=True))

class Email(Base):
    __tablename__ = "emails"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    graph_id = Column(String, unique=True)
    thread_id = Column(String)
    from_email = Column(String)
    subject = Column(Text)
    received_at = Column(TIMESTAMP(timezone=True))
    category = Column(String)
    urgency = Column(Integer)
    summary = Column(Text)
    action_json = Column(JSON)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id"))

class Meeting(Base):
    __tablename__ = "meetings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    graph_event_id = Column(String, unique=True)
    start_ts = Column(TIMESTAMP(timezone=True))
    end_ts = Column(TIMESTAMP(timezone=True))
    attendees = Column(JSON)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id"))
    status = Column(String)
    brief_url = Column(String)
    prepared_ts = Column(TIMESTAMP(timezone=True))

class Note(Base):
    __tablename__ = "notes"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source = Column(String)  # fireflies|plaud|manual
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id"))
    text = Column(Text)
    action_items = Column(JSON)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

class UserToken(Base):
    __tablename__ = "user_tokens"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String, unique=True, nullable=False)  # "tom" for now
    encrypted_access_token = Column(Text, nullable=False)
    encrypted_refresh_token = Column(Text, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

class KnowledgeChunk(Base):
    """Knowledge base chunks with vector embeddings for RAG."""
    __tablename__ = "kb_chunks"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source = Column(String, nullable=False)  # 'email', 'meeting', 'document', 'policy'
    source_id = Column(String, nullable=True)  # email_id, meeting_id, doc_id
    title = Column(String, nullable=False)
    chunk = Column(Text, nullable=False)
    embedding = Column(Text, nullable=True)  # JSON string of embedding vector
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())