import { useEffect } from 'react';

/** Distinct tab titles help screen-reader users and anyone with many tabs open. */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Confer` : 'Confer';
  }, [title]);
}
