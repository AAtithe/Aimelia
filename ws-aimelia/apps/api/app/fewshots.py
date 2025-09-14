"""
Few-Shot Examples Manager
Provides curated examples for consistent tone and style across all AI generations.
"""
from typing import List, Tuple, Dict, Any
import json
import logging

logger = logging.getLogger(__name__)

class FewShotManager:
    """Manages few-shot examples for different tasks."""
    
    def __init__(self):
        self.examples = self._load_examples()
    
    def _load_examples(self) -> Dict[str, List[Tuple[str, str]]]:
        """Load few-shot examples for each task type."""
        return {
            "triage": [
                (
                    "Email from HMRC about VAT return deadline approaching",
                    "URGENT - HMRC VAT deadline\nCategory: Compliance\nAction: Review VAT return, submit by deadline\nPriority: High - financial penalty risk"
                ),
                (
                    "Client asking about payslip issue for new starter",
                    "MEDIUM - Payslip query\nCategory: Payroll\nAction: Check Teampay records, provide payslip\nPriority: Medium - client service"
                ),
                (
                    "Board meeting invitation for next week",
                    "LOW - Meeting invitation\nCategory: Calendar\nAction: Accept, prepare brief\nPriority: Low - routine scheduling"
                )
            ],
            "reply": [
                (
                    "Client: 'Hi Tom, when will our VAT return be ready? We need it by Friday.'",
                    "Hi [Client Name],\n\nThanks for reaching out. I've checked your records and your VAT return is ready for review. I'll send it over by close of business today.\n\nIf you need any adjustments or have questions about the figures, just let me know.\n\nBest regards,\nAimelia"
                ),
                (
                    "HMRC: 'We need clarification on your client's tronc calculations for Q3.'",
                    "Dear HMRC Officer,\n\nThank you for your query regarding [Client Name]'s tronc calculations for Q3.\n\nI've attached the detailed breakdown showing our Troncmaster calculations and supporting documentation. The figures align with HMRC guidelines for tronc distribution.\n\nPlease let me know if you need any additional information.\n\nBest regards,\nAimelia"
                ),
                (
                    "Client: 'Our payroll costs seem higher this month - can you explain?'",
                    "Hi [Client Name],\n\nI've reviewed your payroll costs and the increase is due to:\n\n• Annual salary reviews (3% average increase)\n• Additional overtime for holiday cover\n• New starter onboarding costs\n\nYour total increase is 8.2% month-on-month, which is within expected parameters. I'll send detailed breakdown shortly.\n\nBest regards,\nAimelia"
                )
            ],
            "brief": [
                (
                    "Meeting: 'Q3 Board Review - Public House Group' with CEO, CFO, and Tom",
                    "Q3 Board Review - Public House Group\n\nAttendees: CEO, CFO, Tom Stanley\nDate: [Date] | Time: [Time]\n\nKey Points:\n• Q3 performance review\n• VAT changes impact assessment\n• Troncmaster implementation update\n• Year-end planning\n\nActions:\n• Tom: Prepare VAT impact analysis\n• CFO: Review cash flow projections\n• CEO: Approve Q4 budget adjustments\n\nContext: Public House Group is our largest hospitality client. They're implementing new tronc system and need guidance on VAT implications.\n\nPreparation: Review last quarter's performance, prepare VAT change summary, check Troncmaster rollout status."
                ),
                (
                    "Meeting: 'HMRC Compliance Check - The Crown Inn' with HMRC officer and Tom",
                    "HMRC Compliance Check - The Crown Inn\n\nAttendees: HMRC Officer, Tom Stanley\nDate: [Date] | Time: [Time]\n\nKey Points:\n• VAT return review\n• Payroll compliance check\n• Tronc distribution audit\n• Record keeping assessment\n\nActions:\n• Tom: Prepare all supporting documentation\n• HMRC: Review records and calculations\n• Follow-up: Address any findings within 30 days\n\nContext: The Crown Inn is undergoing routine HMRC compliance check. All records are up-to-date and compliant.\n\nPreparation: Gather VAT returns, payroll records, tronc calculations, and supporting documentation."
                )
            ],
            "digest": [
                (
                    "Daily digest request for Tom's activities",
                    "Daily Digest - [Date]\n\n📧 EMAILS\n• 3 urgent: HMRC VAT query, client payroll issue, board meeting prep\n• 5 medium: Routine queries, meeting confirmations\n• 2 low: Newsletter subscriptions, calendar invites\n\n📅 MEETINGS\n• 10:00 - Public House Group Q3 review\n• 14:00 - HMRC compliance check prep\n• 16:30 - Team standup\n\n🎯 ACTIONS\n• Submit VAT return for The Crown Inn (due today)\n• Prepare board presentation for tomorrow\n• Review Troncmaster rollout status\n\n📊 KEY METRICS\n• 8 emails processed\n• 3 meetings attended\n• 5 actions completed\n\nNext: Focus on VAT deadline and board prep."
                )
            ],
            "analysis": [
                (
                    "Analyze client's payroll costs increase",
                    "Payroll Cost Analysis - [Client Name]\n\nSummary: 8.2% month-on-month increase in payroll costs\n\nKey Drivers:\n• Salary reviews: +3.1% (annual increases)\n• Overtime: +2.8% (holiday cover)\n• New starters: +1.9% (onboarding costs)\n• Benefits: +0.4% (pension contributions)\n\nRecommendations:\n• Review overtime policies to control costs\n• Implement better holiday planning\n• Consider part-time options for new roles\n• Monitor benefits costs quarterly\n\nRisk Assessment: Medium - within acceptable parameters but trend needs monitoring\n\nNext Steps: Present findings to client, implement cost controls, review in 3 months."
                )
            ]
        }
    
    def get_examples(self, task: str, meta: Dict[str, Any]) -> List[Tuple[str, str]]:
        """Get relevant few-shot examples for a task."""
        try:
            examples = self.examples.get(task, [])
            
            # Filter examples based on metadata if needed
            filtered_examples = self._filter_examples(examples, task, meta)
            
            # Return 1-2 most relevant examples
            return filtered_examples[:2]
            
        except Exception as e:
            logger.error(f"Error getting few-shot examples: {e}")
            return []
    
    def _filter_examples(self, examples: List[Tuple[str, str]], 
                        task: str, meta: Dict[str, Any]) -> List[Tuple[str, str]]:
        """Filter examples based on metadata context."""
        # Simple filtering logic - can be enhanced
        if not meta:
            return examples
        
        # For email replies, prefer examples with similar context
        if task == "reply" and "sender" in meta:
            sender = meta["sender"].lower()
            if "hmrc" in sender or "hmrc" in meta.get("subject", "").lower():
                return [ex for ex in examples if "HMRC" in ex[0]]
            elif "client" in sender or "client" in meta.get("subject", "").lower():
                return [ex for ex in examples if "Client" in ex[0]]
        
        # For briefs, prefer examples with similar meeting types
        if task == "brief" and "title" in meta:
            title = meta["title"].lower()
            if "board" in title:
                return [ex for ex in examples if "Board" in ex[0]]
            elif "hmrc" in title:
                return [ex for ex in examples if "HMRC" in ex[0]]
        
        return examples
    
    def add_example(self, task: str, user_input: str, assistant_output: str) -> bool:
        """Add a new few-shot example."""
        try:
            if task not in self.examples:
                self.examples[task] = []
            
            self.examples[task].append((user_input, assistant_output))
            logger.info(f"Added few-shot example for {task}")
            return True
            
        except Exception as e:
            logger.error(f"Error adding few-shot example: {e}")
            return False

# Global instance
fewshot_manager = FewShotManager()
