// Every line the account's half of the popup (account.js) and the options page (settings.js) shows:
// the one place to edit them. The store build and Firefox ship neither, nor this file.
globalThis.IMPECCABLE_WORDS = {
  popup: {
    signIn: 'Sign in',
    signInUnavailable: 'Sign-in isn’t available yet.',
    signedIn: 'Signed in as',
    signedOut: 'Not signed in.',
    signOut: 'Sign out',
    failed: 'Couldn’t sign in. Try again.',
    notPro: 'This account doesn’t have Impeccable Pro.',
  },
  /** The options page's experiment: how the persona sees the page (walks/sight.js), with a persona to pair it with. */
  sight: {
    label: 'How the persona sees (experiment)',
    choices: [
      ['normal', 'Normal', ''],
      ['older', 'Older eyes', 'Pair it with a persona like: Margaret, 74, reading glasses, finds small grey text hard.'],
      ['colour-blind', 'Colour-blind (deuteranopia)', 'Pair it with a persona like: Tom, 35, deuteranopia (red-green colour blindness).'],
    ],
  },
};
