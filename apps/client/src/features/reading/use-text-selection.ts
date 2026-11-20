import { VOCABULARY_LIMITS } from '@ldg/shared';
import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface TextSelection {
  readonly text: string;
  readonly paragraphIndex: number;
  /** Character offsets within the paragraph's text. */
  readonly start: number;
  readonly end: number;
  /**
   * True when set from code (typed search, a suggestion). Only these are
   * highlighted by the reader: re-rendering a paragraph during a native
   * selection would replace its text nodes and break the selection.
   */
  readonly programmatic?: boolean;
}

export type SelectionState = { readonly kind: 'none' } | { readonly kind: 'valid'; readonly selection: TextSelection } | { readonly kind: 'invalid'; readonly reason: string };

/** Paragraphs carry `data-paragraph="<index>"`; the selection must stay inside one of them. */
function paragraphOf(node: Node | null, container: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== container) {
    if (current instanceof HTMLElement && current.dataset.paragraph !== undefined) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * Tracks the learner's text selection inside the reader (mouse, keyboard or
 * touch: `selectionchange` covers all three). Only selections within one
 * paragraph and of at most eight words are offered for lookup.
 */
export function useTextSelection(containerRef: RefObject<HTMLElement | null>) {
  const [state, setState] = useState<SelectionState>({ kind: 'none' });

  useEffect(() => {
    const onChange = () => {
      const container = containerRef.current;
      const selection = document.getSelection();
      if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        // Clicking the lookup button collapses the selection; keep the last one until it is replaced or cleared.
        return;
      }
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;
      const startParagraph = paragraphOf(range.startContainer, container);
      const endParagraph = paragraphOf(range.endContainer, container);
      if (!startParagraph || startParagraph !== endParagraph) {
        setState({ kind: 'invalid', reason: 'Select words within a single paragraph.' });
        return;
      }
      const raw = selection.toString();
      const text = raw.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (text === '') return;
      if (text.split(' ').length > VOCABULARY_LIMITS.maxExpressionWords || text.length > VOCABULARY_LIMITS.maxExpressionChars) {
        setState({ kind: 'invalid', reason: `Select at most ${VOCABULARY_LIMITS.maxExpressionWords} words to look up.` });
        return;
      }
      const before = document.createRange();
      before.setStart(startParagraph, 0);
      before.setEnd(range.startContainer, range.startOffset);
      const leading = raw.length - raw.trimStart().length;
      const start = before.toString().length + leading;
      setState({ kind: 'valid', selection: { text, paragraphIndex: Number(startParagraph.dataset.paragraph), start, end: start + text.length } });
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [containerRef]);

  const clear = useCallback(() => {
    setState({ kind: 'none' });
    document.getSelection()?.removeAllRanges();
  }, []);

  const set = useCallback((selection: TextSelection) => {
    document.getSelection()?.removeAllRanges();
    setState({ kind: 'valid', selection: { ...selection, programmatic: true } });
  }, []);

  return { state, clear, set };
}
