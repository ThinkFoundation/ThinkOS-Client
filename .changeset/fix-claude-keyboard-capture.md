---
"think-extension": patch
---

Fix keyboard input being captured by host page when using extension on Claude.ai

- Add delegatesFocus option to Shadow DOM for better focus handling
- Stop focus events (focusin/focusout) from propagating to host document
- Stop keyboard events (keydown/keyup/keypress) from propagating to host document
- Prevents sites like Claude.ai from intercepting keystrokes intended for the extension
