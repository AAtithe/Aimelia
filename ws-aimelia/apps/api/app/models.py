from sqlalchemy import Column, String, JSON, TIMESTAMP, Integer, ForeignKey, Text
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