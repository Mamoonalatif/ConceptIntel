// Assignment/submission download endpoints require the Authorization header (they're
// not public URLs), so a plain <a href> won't work - fetch as a blob with the token
// attached, then trigger a save via a throwaway object URL.
export async function downloadAuthenticated(url: string, filename: string): Promise<void> {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
