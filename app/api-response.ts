export async function readApiResponse(response: Response): Promise<any> {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(response.ok
      ? 'The server returned an unexpected response. Please reload and try again.'
      : `The server could not complete the request (HTTP ${response.status}). Please try again.`);
  }
}
