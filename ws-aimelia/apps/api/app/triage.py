# Placeholders for rule-based + LLM classification

def quick_rules(subject: str, sender: str) -> str | None:
    s = (subject or "").lower(); f = (sender or "").lower()
    if any(k in s for k in ["payslip","timesheet","payroll"]):
        return "Payroll"
    if any(k in s for k in ["vat","paye","nic","hmrc"]):
        return "Tax"
    if "meeting" in s or "calendar" in s:
        return "Scheduling"
    return None