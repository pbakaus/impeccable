# Journey playbooks

Use when writing or auditing **Journey Playbooks** in COPY.md. Every product COPY.md must include at least **5–8** journeys ranked by business importance — not inferred only from string frequency.

## Per-journey template

For each journey, document:

| Field | Question |
|-------|----------|
| **Journey** | Name (e.g. "Upgrade to paid plan") |
| **Primary persona** | Who (use operator audience matrix if applicable) |
| **Job to be done** | What success looks like |
| **User anxiety** | What they're afraid of getting wrong |
| **Desired feeling** | e.g. in control, invited, safe |
| **Copy role** | What language must do in this flow |
| **Key moments** | Ordered screens/steps (from code or product knowledge) |
| **Example copy** | 2–4 real or target strings per moment |
| **Anti-patterns** | What this journey must never sound like |

## Default journey candidates (product / B2B)

Pick what applies; do not list all generically without evidence:

**Operator / admin**
- First-time workspace setup
- Invite teammates or assign roles
- Feature enablement (especially AI or integrations)
- Billing or plan change
- Analytics review / drill-down
- Developer integration setup (API keys, webhooks)
- Destructive configuration change

**End user / member**
- Anonymous visit → registration
- Sign-in failure / account recovery
- First core action (first task, first post, first file)
- Search with no results
- Permission denied
- Receiving AI-generated help
- Destructive content action

**Marketing / brand** (register: brand)
- Landing → pricing → signup
- Feature story → proof → CTA
- Documentation → quickstart → install

## Sequencing rule

Journey copy is about **order**: what the user sees first, what anxiety you remove next, what decision you enable. A journey playbook without ordered moments is not a playbook.

## Evidence sources

1. Route map / feature registry in code
2. `PRODUCT.md` user and purpose sections
3. User or stakeholder input (interview Step 4)
4. Representative locale files along the flow — not isolated keys
