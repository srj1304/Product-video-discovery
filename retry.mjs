export async function withRetry(fn, {
  retries = 2,
  baseDelayMs = 500,
  maxDelayMs = 5000,
  shouldRetry = () => true,
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error;
      const jitter = Math.floor(Math.random() * Math.min(250, baseDelayMs));
      const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt) + jitter);
      await onRetry(error, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
