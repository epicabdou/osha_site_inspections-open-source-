/** The disclaimer text, shared by the footer and the README. Keep them identical. */
export const DISCLAIMER =
  'Demo project. The checklists are illustrative and are not a substitute for an inspection by a competent person or for any legal requirement.';

export function DisclaimerFooter() {
  return (
    <footer className="border-border text-muted border-t px-4 py-3 text-center text-sm">
      <p>{DISCLAIMER}</p>
    </footer>
  );
}
