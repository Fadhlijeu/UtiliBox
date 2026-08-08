// Pure base64 helpers — chunked conversion to survive large inputs
// without blowing the spread-operator call stack.

const CHUNK = 0x8000;

export const encodeBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

export const decodeBase64 = (base64: string): string => {
  const binary = atob(base64.trim().replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};