/** Static fallback that is prerendered into /field and shown until the app mounts. */
export function FieldAppLoading() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <p role="status" className="text-muted text-lg">
        Opening the inspector app…
      </p>
    </main>
  );
}
