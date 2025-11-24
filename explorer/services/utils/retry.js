/**
 * Simple async retry helper. Retries the provided function if it throws.
 * @template T
 * @param {() => Promise<T>} operation
 * @param {{ retries?: number, delayMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(operation, { retries = 2, delayMs = 50 } = {}) {
    let attempt = 0;
    let lastError;
    while (attempt <= retries) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt === retries) {
                break;
            }
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        attempt += 1;
    }
    throw lastError;
}
