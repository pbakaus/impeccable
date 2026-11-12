// Every line the account's half of the popup (account.js) shows:
// the one place to edit them. The store build and Firefox ship neither, nor this file.
globalThis.IMPECCABLE_WORDS = {
  popup: {
    signIn: 'Sign in to Impeccable Pro',
    signInUnavailable: 'Sign-in isn’t available yet.',
    signedIn: 'Signed in as',
    signedOut: 'Not signed in.',
    failed: 'Couldn’t sign in. Try again.',
    noPersonas: 'No personas yet.',
    personasFailed: 'Couldn’t load your personas.',
    walkThis: 'Walk this tab',
    presets: 'Presets',
    /** Six people to walk with before the person has their own; the server holds each one's card by its id. */
    presetList: [
      { id: 'ines', name: 'Ines', line: 'A retired teacher, careful with every word and the small print.' },
      { id: 'kofi', name: 'Kofi', line: 'A commuter doing one errand on his phone, one thumb free.' },
      { id: 'priya', name: 'Priya', line: 'An analyst comparing options before she decides.' },
      { id: 'tomasz', name: 'Tomasz', line: 'A developer who notices what every button really does.' },
      { id: 'hana', name: 'Hana', line: 'A first-time visitor who reads English as a second language.' },
      { id: 'noor', name: 'Noor', line: 'A sceptical buyer looking for the catch before signing up.' },
    ],
    task: 'What should they try?',
    taskHint: 'Open the top five stories and tell me which is most interesting.',
    start: 'Start walk',
    cancel: 'Cancel',
    started: 'Walk started. Follow it from the Impeccable icon.',
    startedPanel: 'Walk started.',
    walkUnavailable: 'Walks from the extension aren’t available yet.',
    walkScope: 'Sign in again to start walks.',
    walkTab: 'This tab can’t be walked. Open a web page first.',
    walkFailed: 'Couldn’t start the walk. Try again.',
    create: 'Create a persona',
    createLabel: 'Who are they?',
    createHint: 'A night-shift nurse checking a pharmacy’s opening hours on her phone.',
    createGo: 'Create',
    creating: 'Creating…',
    creatingNote: 'This takes a few seconds. You can close this; they’ll be here when you’re back.',
    createShort: 'Describe them in a sentence or two.',
    /** `max`: how many the server keeps per person, as its answer says. */
    createLimit: (max) => (Number.isInteger(max) && max > 0
      ? `You have ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][max] ?? max} persona${max === 1 ? '' : 's'}. Remove one to make another.`
      : 'You have all the personas you can. Remove one to make another.'),
    createQuota: 'That’s today’s personas. Try again tomorrow.',
    createScope: 'Sign in again to create personas.',
    createUnavailable: 'Creating personas isn’t available yet.',
    createFailed: 'Couldn’t create them. Try describing them again.',
    remove: 'Remove',
    removeAsk: (name) => `Remove ${name}?`,
    keep: 'Keep',
    removeFailed: 'Couldn’t remove them. Try again.',
  },
};
