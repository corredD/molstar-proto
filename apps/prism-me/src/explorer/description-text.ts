/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { markdownInlineText, parseMarkdownInline } from '@molstar/core/util/markdown';

/** How long a description's text goes in a row's card, cut at a word past it (its whole text is in the properties) */
const DescriptionTipLength = 200;

/** A description (Markdown: an entity's, from its file) as one line of text: a link's text, no brackets; cut past 200 */
export function descriptionText(markdown: string): string {
  const text = markdownInlineText(parseMarkdownInline(markdown)).replace(/\s+/g, ' ').trim();
  if (text.length <= DescriptionTipLength) return text;
  const space = text.lastIndexOf(' ', DescriptionTipLength);
  return `${text.slice(0, space > 0 ? space : DescriptionTipLength)}…`;
}
