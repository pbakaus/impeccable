# Copy decision trees

Use for **Errors**, **Empty states**, and **Success** sections in COPY.md. Formulas alone are insufficient.

## Error messages

```
What failed?
├── Validation (user can fix input)
│   └── Imperative: what to enter + example if helpful
├── Permission (user cannot fix)
│   └── What they can't do + who can help (admin, owner)
├── Network / timeout
│   └── Name the action + retry + wait if known
├── Conflict / state (stale data)
│   └── What changed + refresh or review
└── Unknown server error
    └── Name the action if possible + retry; avoid bare codes
```

Never blame the user. Never expose raw codes to end users without explanation.

## Empty states

Classify before writing:

| Type | User need | Copy job |
|------|-----------|----------|
| **First-use / setup incomplete** | Get started | Educate + primary CTA |
| **Filtered / no matches** | Adjust search | Name filter + suggest change |
| **New workspace / no content yet** | Activation | Invite first action (role-aware) |
| **Permission-limited** | Understand gap | Explain restriction + path |
| **Not yet generated** | Wait or configure | Explain when data appears |
| **Failed load** | Recover | Error pattern, not empty pattern |

**Weak:** "No items"  
**Better:** "No projects yet. Create your first project to start tracking work."  
**Role-aware:** Workspace admin vs member may need different CTAs for the same empty surface.

## Success messages (especially operator)

Answer when relevant:
- **What changed?**
- **Who/what is affected?**
- **When does it take effect?**
- **Next step?**
- **Undo/review path?**

**Weak:** Success  
**Better:** "Teammate invite sent. They'll get access when they accept the email."

Simple actions may use brief success; high-risk configuration must not.

## Before / after tables

Every decision tree section in COPY.md should include at least one **Weak | Better | Why** table with real or realistic product examples.
