export async function request<T>(
  token: string,
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-local-session": token,
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed.");
  return result;
}
