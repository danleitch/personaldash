/** A short stand-in for a secret in a cache key, so the secret itself isn't spelled out there. */
export const fingerprint = (text: string): string => {
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
};
