# Gemini Context

This repository contains specialized skills for different tasks. When you detect a user request in a particular domain, the corresponding skill file will be automatically loaded to provide detailed guidance.

## Available Skills

Each skill provides deep expertise in its domain. The skills below are automatically imported and will guide your responses:

### frontend-design

**When to use**: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.

@./GEMINI.frontend-design.md


## How Skills Work

1. Skills are automatically loaded via the import statements above
2. When a user request matches a skill domain, apply that skill's guidance
3. Multiple skills can be combined when the task requires expertise from different domains
4. Follow the detailed instructions provided in each imported skill file