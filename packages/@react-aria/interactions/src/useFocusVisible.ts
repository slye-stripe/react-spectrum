/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// Portions of the code in this file are based on code from react.
// Original licensing for the following can be found in the
// NOTICE file in the root directory of this source tree.
// See https://github.com/facebook/react/tree/cc7c1aece46a6b69b41958d731e0fd27c94bfc6c/packages/react-interactions

import {isMac} from '@react-aria/utils';
import {isVirtualClick} from './utils';
import {useEffect, useState} from 'react';

const getOwnerDocument = (el: Element | null | undefined): Document => el?.ownerDocument ?? document;

const getOwnerWindow = (
  el: (Window & typeof global) | Element | null | undefined
): Window & typeof global => {
  if (el && 'window' in el && el.window === el) {
    return el;
  }

  const doc = getOwnerDocument(el as Element | null | undefined);
  return doc.defaultView || window;
};

export type Modality = 'keyboard' | 'pointer' | 'virtual';
type HandlerEvent = PointerEvent | MouseEvent | KeyboardEvent | FocusEvent;
type Handler = (modality: Modality, e: HandlerEvent) => void;
export type FocusVisibleHandler = (isFocusVisible: boolean) => void;
interface FocusVisibleProps {
  /** Whether the element is a text input. */
  isTextInput?: boolean,
  /** Whether the element will be auto focused. */
  autoFocus?: boolean
}

export interface FocusVisibleResult {
  /** Whether keyboard focus is visible globally. */
  isFocusVisible: boolean
}

let currentModality = null;
let changeHandlers = new Set<Handler>();
let hasSetupGlobalListeners = new Map<Window, boolean>();
let hasEventBeforeFocus = false;
let hasBlurredWindowRecently = false;

// Only Tab or Esc keys will make focus visible on text input elements
const FOCUS_VISIBLE_INPUT_KEYS = {
  Tab: true,
  Escape: true
};

function triggerChangeHandlers(modality: Modality, e: HandlerEvent) {
  for (let handler of changeHandlers) {
    handler(modality, e);
  }
}

/**
 * Helper function to determine if a KeyboardEvent is unmodified and could make keyboard focus styles visible.
 */
function isValidKey(e: KeyboardEvent) {
  // Control and Shift keys trigger when navigating back to the tab with keyboard.
  return !(e.metaKey || (!isMac() && e.altKey) || e.ctrlKey || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta');
}


function handleKeyboardEvent(e: KeyboardEvent) {
  hasEventBeforeFocus = true;
  if (isValidKey(e)) {
    currentModality = 'keyboard';
    triggerChangeHandlers('keyboard', e);
  }
}

function handlePointerEvent(e: PointerEvent | MouseEvent) {
  currentModality = 'pointer';
  if (e.type === 'mousedown' || e.type === 'pointerdown') {
    hasEventBeforeFocus = true;
    triggerChangeHandlers('pointer', e);
  }
}

function handleClickEvent(e: MouseEvent) {
  if (isVirtualClick(e)) {
    hasEventBeforeFocus = true;
    currentModality = 'virtual';
  }
}

function handleFocusEvent(e: FocusEvent) {
  // Firefox fires two extra focus events when the user first clicks into an iframe:
  // first on the window, then on the document. We ignore these events so they don't
  // cause keyboard focus rings to appear.
  const windowObject = getOwnerWindow(e.target as HTMLElement);
  const documentObject = getOwnerDocument(e.target as HTMLElement);
  if (e.target === windowObject || e.target === documentObject) {
    return;
  }

  // If a focus event occurs without a preceding keyboard or pointer event, switch to virtual modality.
  // This occurs, for example, when navigating a form with the next/previous buttons on iOS.
  if (!hasEventBeforeFocus && !hasBlurredWindowRecently) {
    currentModality = 'virtual';
    triggerChangeHandlers('virtual', e);
  }

  hasEventBeforeFocus = false;
  hasBlurredWindowRecently = false;
}

function handleWindowBlur() {
  // When the window is blurred, reset state. This is necessary when tabbing out of the window,
  // for example, since a subsequent focus event won't be fired.
  hasEventBeforeFocus = false;
  hasBlurredWindowRecently = true;
}

/**
 * Setup global event listeners to control when keyboard focus style should be visible.
 */
function setupGlobalFocusEvents(element?: HTMLElement | null) {
  if (typeof window === 'undefined' || hasSetupGlobalListeners.get(getOwnerWindow(element))) {
    return;
  }

  const windowObject = getOwnerWindow(element);
  const documentObject = getOwnerDocument(element);

  // Programmatic focus() calls shouldn't affect the current input modality.
  // However, we need to detect other cases when a focus event occurs without
  // a preceding user event (e.g. screen reader focus). Overriding the focus
  // method on HTMLElement.prototype is a bit hacky, but works.
  let focus = windowObject.HTMLElement.prototype.focus;
  windowObject.HTMLElement.prototype.focus = function () {
    hasEventBeforeFocus = true;
    focus.apply(this, arguments);
  };

  documentObject.addEventListener('keydown', handleKeyboardEvent, true);
  documentObject.addEventListener('keyup', handleKeyboardEvent, true);
  documentObject.addEventListener('click', handleClickEvent, true);

  // Register focus events on the window so they are sure to happen
  // before React's event listeners (registered on the document).
  window.addEventListener('focus', handleFocusEvent, true);
  window.addEventListener('blur', handleWindowBlur, false);

  if (typeof PointerEvent !== 'undefined') {
    documentObject.addEventListener('pointerdown', handlePointerEvent, true);
    documentObject.addEventListener('pointermove', handlePointerEvent, true);
    documentObject.addEventListener('pointerup', handlePointerEvent, true);
  } else {
    documentObject.addEventListener('mousedown', handlePointerEvent, true);
    documentObject.addEventListener('mousemove', handlePointerEvent, true);
    documentObject.addEventListener('mouseup', handlePointerEvent, true);
  }

  hasSetupGlobalListeners.set(windowObject, true);
}

export const setupFocus = (element?: HTMLElement | null) => {
  const documentObject = getOwnerDocument(element);
  if (documentObject.readyState !== 'loading') {
    setupGlobalFocusEvents(element);
  } else {
    documentObject.addEventListener('DOMContentLoaded', () =>
      setupGlobalFocusEvents(element)
    );
  }
};

// Server-side rendering does not have the document object defined
if (typeof document !== 'undefined') {
  setupFocus();
}

/**
 * If true, keyboard focus is visible.
 */
export function isFocusVisible(): boolean {
  return currentModality !== 'pointer';
}

export function getInteractionModality(): Modality {
  return currentModality;
}

export function setInteractionModality(modality: Modality) {
  currentModality = modality;
  triggerChangeHandlers(modality, null);
}

/**
 * Keeps state of the current modality.
 */
export function useInteractionModality(): Modality {
  setupGlobalFocusEvents();

  let [modality, setModality] = useState(currentModality);
  useEffect(() => {
    let handler = () => {
      setModality(currentModality);
    };

    changeHandlers.add(handler);
    return () => {
      changeHandlers.delete(handler);
    };
  }, []);

  return modality;
}

/**
 * If this is attached to text input component, return if the event is a focus event (Tab/Escape keys pressed) so that
 * focus visible style can be properly set.
 */
function isKeyboardFocusEvent(isTextInput: boolean, modality: Modality, e: HandlerEvent) {
  const IKeyboardEvent = typeof window !== undefined ? getOwnerWindow(e?.target as HTMLElement).KeyboardEvent : KeyboardEvent;
  return !(isTextInput && modality === 'keyboard' && e instanceof IKeyboardEvent && !FOCUS_VISIBLE_INPUT_KEYS[e.key]);
}

/**
 * Manages focus visible state for the page, and subscribes individual components for updates.
 */
export function useFocusVisible(props: FocusVisibleProps = {}): FocusVisibleResult {
  let {isTextInput, autoFocus} = props;
  let [isFocusVisibleState, setFocusVisible] = useState(autoFocus || isFocusVisible());
  useFocusVisibleListener((isFocusVisible) => {
    setFocusVisible(isFocusVisible);
  }, [isTextInput], {isTextInput});

  return {isFocusVisible: isFocusVisibleState};
}

/**
 * Listens for trigger change and reports if focus is visible (i.e., modality is not pointer).
 */
export function useFocusVisibleListener(fn: FocusVisibleHandler, deps: ReadonlyArray<any>, opts?: {isTextInput?: boolean}): void {
  setupGlobalFocusEvents();

  useEffect(() => {
    let handler = (modality: Modality, e: HandlerEvent) => {
      if (!isKeyboardFocusEvent(opts?.isTextInput, modality, e)) {
        return;
      }
      fn(isFocusVisible());
    };
    changeHandlers.add(handler);
    return () => {
      changeHandlers.delete(handler);
    };
  }, deps);
}
