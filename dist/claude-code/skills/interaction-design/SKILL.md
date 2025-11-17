---
name: interaction-design
description: Design intuitive interaction patterns that feel natural and provide clear feedback. Use this skill when building interactive components, designing forms, or establishing interaction standards. Creates accessible, forgiving interfaces where every state is clear and every action provides immediate feedback.
license: Complete terms in LICENSE.txt
---

This skill guides the creation of interaction patterns that are intuitive, accessible, and delightful - the conversation between user and interface.

The user provides an interaction challenge: designing forms, improving button states, fixing navigation patterns, optimizing input UX, implementing keyboard navigation, or creating feedback mechanisms. They may include accessibility requirements, device constraints, or specific interaction problems to solve.

## Interaction Design Thinking

Before designing interactions, understand the user's mental model and context:

- **User Context**: What are users trying to accomplish? What's their experience level? What's their emotional state (stressed during checkout vs relaxed browsing)?
- **Device & Input**: Touch vs pointer? Keyboard navigation? Voice input? Gamepad? Different inputs need different affordances.
- **Error Tolerance**: High-stakes actions (delete, purchase) vs low-stakes (filter, sort)? Design appropriate safeguards.
- **Speed vs Accuracy**: Quick scanning vs careful reading? Simple taps vs precise manipulation?

**CRITICAL**: Good interaction design is invisible. Users should complete tasks without thinking about the interface.

Then implement interactions that are:
- Intuitive with clear affordances and feedback
- Accessible to all users and input methods
- Forgiving with error prevention and recovery
- Responsive with immediate feedback and state changes

## Interaction States

### Core States

[TO BE DEVELOPED: Default, hover, focus, active, disabled, loading, error, success - visual treatment for each]

### State Transitions

[TO BE DEVELOPED: Smooth state changes, animation between states, maintaining context, preserving user intent]

### Loading & Progress States

[TO BE DEVELOPED: Skeleton screens, spinners, progress bars, optimistic updates, what to show while waiting]

## Affordances & Feedback

### Visual Affordances

[TO BE DEVELOPED: Signaling interactivity, button appearance, link styling, cursor changes, touch target highlighting]

### Immediate Feedback

[TO BE DEVELOPED: Click/tap acknowledgment, hover feedback, focus indication, "something is happening" signals]

### Haptic & Sound Feedback

[TO BE DEVELOPED: Vibration patterns, sound cues, cross-modal feedback, when to use non-visual feedback]

## Form Design & Input Patterns

### Form Layout & Structure

[TO BE DEVELOPED: Single column vs multi-column, label placement, field grouping, visual hierarchy in forms]

### Input Field Design

[TO BE DEVELOPED: Field sizing, placeholder usage (anti-pattern), helper text, character limits, input masking]

### Validation Patterns

[TO BE DEVELOPED: Inline vs on-submit, real-time validation, error message writing, success confirmation, required field indication]

### Complex Input Types

[TO BE DEVELOPED: File upload UX, date pickers, time selection, rich text editing, multi-select, autocomplete, search]

### Progressive Disclosure in Forms

[TO BE DEVELOPED: Conditional fields, wizards/multi-step forms, accordions, showing complexity gradually]

### Form Error Handling

[TO BE DEVELOPED: Error prevention (constraints, masks), clear error messages, error recovery, field-level vs form-level errors]

## Touch & Pointer Interactions

### Touch Targets

[TO BE DEVELOPED: 44x44px minimum, spacing between targets, thumb zones, edge reach areas on mobile]

### Touch vs Pointer Patterns

[TO BE DEVELOPED: Hover states on touch (problems), tap feedback, long press, swipe gestures, pinch-to-zoom]

### Gesture Design

[TO BE DEVELOPED: Swipe to delete, pull to refresh, drag to reorder, custom gestures, gesture discoverability]

## Keyboard Navigation

### Focus Management

[TO BE DEVELOPED: Focus rings (never remove without replacement), logical tab order, skip links, focus trapping in modals]

### Keyboard Shortcuts

[TO BE DEVELOPED: Common shortcuts, discoverability, avoiding conflicts, command palettes, keyboard-first workflows]

### Accessible Interaction Patterns

[TO BE DEVELOPED: ARIA roles for custom controls, managing focus in dynamic content, screen reader announcements]

## Navigation Patterns

### Menu & Navigation Design

[TO BE DEVELOPED: Mega menus, hamburger menus, breadcrumbs, tabs, pagination, infinite scroll vs load more]

### Modal & Dialog Patterns

[TO BE DEVELOPED: Modal entry/exit, focus management, escape to close, backdrop click behavior, sheet patterns]

### Command & Context Menus

[TO BE DEVELOPED: Right-click menus, command palettes, dropdown menus, action sheets]

## Error Prevention & Recovery

### Constraints & Guards

[TO BE DEVELOPED: Input constraints, disabled states, confirmation dialogs for destructive actions, undo mechanisms]

### Error Messages

[TO BE DEVELOPED: Clear language, actionable guidance, positive framing, where to show errors, when to show errors]

### Undo & Redo

[TO BE DEVELOPED: Undo patterns, toast notifications with undo, versioning, draft auto-save]

---

**IMPORTANT**: Test interactions with actual users and diverse input methods. What works with a mouse might fail with touch or keyboard.

**NEVER**:
- Remove focus indicators without providing visible alternatives (accessibility violation)
- Use placeholder text as labels (disappears on input, hard to remember)
- Make touch targets smaller than 44x44px
- Validate in real-time for long inputs (wait for blur)
- Show generic error messages ("Error occurred") - be specific and helpful
- Block user interaction without clear loading states
- Design only for mouse/pointer (test with keyboard and touch)
- Use custom controls without proper ARIA and keyboard support

Remember: Interaction design is where users actually experience your interface. Get this right, and everything else falls into place.