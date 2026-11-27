import { Fragment } from 'react';
import { segmentText, type SearchRange, type TextRange } from '../textHighlight';

interface HighlightedTextProps {
  text: string;
  /** Ranges shown bold (highlight terms). */
  boldRanges?: readonly TextRange[];
  /** Ranges shown with a search background; `current` is emphasized. */
  searchRanges?: readonly SearchRange[];
}

/** Renders transcript text with merged search and term highlighting. */
export default function HighlightedText({
  text,
  boldRanges = [],
  searchRanges = [],
}: HighlightedTextProps) {
  if (boldRanges.length === 0 && searchRanges.length === 0) return <>{text}</>;
  return (
    <>
      {segmentText(text, boldRanges, searchRanges).map((segment) => {
        const content = segment.bold ? (
          <strong className="font-bold" data-highlight-term="">
            {segment.text}
          </strong>
        ) : (
          segment.text
        );
        if (!segment.search) {
          return <Fragment key={segment.start}>{content}</Fragment>;
        }
        return (
          <mark
            key={segment.start}
            data-search-hit={segment.current ? 'current' : ''}
            className={
              segment.current
                ? 'rounded-sm bg-yellow-400 text-inherit ring-2 ring-yellow-600'
                : 'rounded-sm bg-yellow-200 text-inherit'
            }
          >
            {content}
          </mark>
        );
      })}
    </>
  );
}
