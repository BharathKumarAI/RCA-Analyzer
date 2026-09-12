---
id: ticket-review
version: 1.0.0
summary: Review a Jira ticket using only bounded, scoped ticket evidence.
category: investigation
entrypoints:
  - retrieve_ticket
  - assess_ticket
required_tools:
  - itsm.get_ticket
forbidden_tools:
  - itsm.add_comment
  - itsm.delete_ticket
input_schema: TicketReviewContext
output_schema: TicketReviewResult
status: approved
---

# Ticket Review Skill

## Workflow

1. Retrieve the requested Jira ticket only when the request requires ticket review.
2. Extract the incident summary, status, timestamps, affected service, and stated impact.
3. Separate ticket claims from conclusions, cite supplied evidence IDs, and identify missing information.
4. Do not modify the ticket or infer facts that are absent from the returned evidence.
