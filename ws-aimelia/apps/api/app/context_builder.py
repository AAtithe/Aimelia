"""
Context Builder - Unified system for assembling AI context
Combines persona, retrieved knowledge, and few-shot examples for consistent AI responses.
"""
import os
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
# Removed circular import - knowledge_retriever will be imported when needed
from .fewshots import FewShotManager
from .db import get_db
import logging

logger = logging.getLogger(__name__)

class ContextBuilder:
    """Builds comprehensive context for AI generations."""
    
    def __init__(self):
        self.persona_path = Path(__file__).parent / "persona" / "tom_profile.md"
        self.fewshot_manager = FewShotManager()
    
    def load_persona(self) -> str:
        """Load Tom Stanley's persona profile."""
        try:
            with open(self.persona_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error loading persona: {e}")
            return self._get_fallback_persona()
    
    def _get_fallback_persona(self) -> str:
        """Fallback persona if file loading fails."""
        return """You are Aimelia, Tom Stanley's AI assistant at Williams, Stanley & Co (hospitality accountants).
Be concise, use UK spelling, and focus on hospitality sector expertise. Never auto-send emails."""
    
    async def build_context(self, task: str, meta: Dict[str, Any], 
                          query: str, top_k: int = 6) -> List[Dict[str, str]]:
        """
        Build comprehensive context for AI generation.
        
        Args:
            task: 'triage' | 'reply' | 'brief' | 'digest' | 'analysis'
            meta: Live context (attendees, email preview, etc.)
            query: Retrieval hint (client name, subject, etc.)
            top_k: Number of knowledge chunks to retrieve
        """
        try:
            # 1. Load persona
            system_prompt = self.load_persona()
            
            # 2. Retrieve relevant knowledge
            db = next(get_db())
            # Import knowledge_retriever here to avoid circular import
            from .knowledge_base import knowledge_retriever
            knowledge_chunks = await knowledge_retriever.retrieve_chunks(
                db, query, top_k
            )
            
            # 3. Get few-shot examples
            fewshot_examples = self.fewshot_manager.get_examples(task, meta)
            
            # 4. Build messages
            messages = [{"role": "system", "content": system_prompt}]
            
            # Add few-shot examples
            for user_msg, assistant_msg in fewshot_examples:
                messages.extend([
                    {"role": "user", "content": user_msg},
                    {"role": "assistant", "content": assistant_msg}
                ])
            
            # Add current task context
            context_prompt = self._build_context_prompt(task, meta, knowledge_chunks)
            messages.append({"role": "user", "content": context_prompt})
            
            logger.info(f"Built context for {task}: {len(knowledge_chunks)} chunks, {len(fewshot_examples)} examples")
            return messages
            
        except Exception as e:
            logger.error(f"Error building context: {e}")
            return self._get_fallback_context(task, meta)
    
    def _build_context_prompt(self, task: str, meta: Dict[str, Any], 
                            knowledge_chunks: List[Dict]) -> str:
        """Build the main context prompt with retrieved knowledge."""
        
        # Task-specific context
        task_context = self._get_task_context(task, meta)
        
        # Knowledge context
        knowledge_context = ""
        if knowledge_chunks:
            knowledge_context = "Relevant background information:\n"
            for i, chunk in enumerate(knowledge_chunks, 1):
                knowledge_context += f"{i}. [{chunk['source']}] {chunk['title']}: {chunk['chunk'][:200]}...\n"
        
        # Live metadata
        meta_context = f"Current context: {json.dumps(meta, indent=2)}"
        
        return f"""Task: {task}

{task_context}

{knowledge_context}

{meta_context}

Please respond according to your persona and the context provided above."""
    
    def _get_task_context(self, task: str, meta: Dict[str, Any]) -> str:
        """Get task-specific instructions."""
        task_contexts = {
            "triage": "Analyze this email and determine urgency, category, and suggested actions. Be decisive and concise.",
            "reply": "Draft a professional email reply. Use UK spelling, be concise (120-180 words), and include clear next steps.",
            "brief": "Create a meeting brief with key points, actions, and context. Keep it under 300 words.",
            "digest": "Summarize the key items from today's activities. Focus on actions and decisions.",
            "analysis": "Analyze the provided information and provide insights with recommended actions."
        }
        return task_contexts.get(task, "Complete the requested task professionally and concisely.")
    
    def _get_fallback_context(self, task: str, meta: Dict[str, Any]) -> List[Dict[str, str]]:
        """Fallback context if building fails."""
        return [
            {"role": "system", "content": self._get_fallback_persona()},
            {"role": "user", "content": f"Task: {task}\nContext: {json.dumps(meta)}"}
        ]

# Global instance
context_builder = ContextBuilder()
