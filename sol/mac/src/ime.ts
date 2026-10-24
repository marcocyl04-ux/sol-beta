import type { KeyboardEvent } from "react";

// The Enter (or Escape, Tab) that ends an IME conversion, Chinese, Japanese or Korean, belongs to the
// input method, not to the box. Chrome marks that keydown isComposing. WebKit, the face's shell,
// fires compositionend first, so the keydown arrives with isComposing false and only keyCode 229
// says the IME owned it (https://bugs.webkit.org/show_bug.cgi?id=165004). Ask this, never isComposing alone.
export const composing = (ev: KeyboardEvent<Element>): boolean =>
  ev.nativeEvent.isComposing || ev.nativeEvent.keyCode === 229;
