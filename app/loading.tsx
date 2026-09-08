export default function WorkspaceLoading() {
  return (
    <main className="workspace-feedback" aria-busy="true">
      <p role="status">Loading your workspace…</p>
      <div className="loading-placeholder" aria-hidden="true" />
      <div className="loading-placeholder" aria-hidden="true" />
    </main>
  );
}
